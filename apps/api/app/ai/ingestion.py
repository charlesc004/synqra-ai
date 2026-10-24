import asyncio
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile

import tiktoken
from docx import Document as DocxDocument
from pypdf import PdfReader
from rq import get_current_job
from sqlalchemy import delete, func, select

from app.ai.providers import embed
from app.core.config import settings
from app.core.database import SessionLocal
from app.models import Chunk, Collection, Document


@dataclass(frozen=True)
class Section:
    text: str
    page: int | None = None
    heading: str | None = None


@dataclass(frozen=True)
class TextChunk:
    text: str
    page: int | None
    section: str | None
    token_start: int
    token_end: int


def extract(path: Path, suffix: str) -> list[Section]:
    if suffix == ".pdf":
        reader = PdfReader(path)
        if reader.is_encrypted or len(reader.pages) > 500:
            raise ValueError("Encrypted PDFs and PDFs over 500 pages are unsupported")
        sections = [Section(page.extract_text() or "", i + 1) for i, page in enumerate(reader.pages)]
    elif suffix == ".docx":
        with ZipFile(path) as archive:
            if sum(item.file_size for item in archive.infolist()) > 50 * 1024 * 1024:
                raise ValueError("Expanded document exceeds the 50 MB parsing limit")
        sections = []
        heading = "Document"
        paragraphs: list[str] = []
        for paragraph in DocxDocument(str(path)).paragraphs:
            if paragraph.style and paragraph.style.name.startswith("Heading"):
                if paragraphs:
                    sections.append(Section("\n\n".join(paragraphs), heading=heading))
                heading, paragraphs = paragraph.text[:240], []
            if paragraph.text.strip():
                paragraphs.append(paragraph.text)
        if paragraphs:
            sections.append(Section("\n\n".join(paragraphs), heading=heading))
    else:
        content = path.read_text(encoding="utf-8-sig")
        sections = []
        heading, paragraphs = "Document", []
        for line in content.splitlines():
            if suffix == ".md" and re.match(r"^#{1,6}\s", line):
                if paragraphs:
                    sections.append(Section("\n".join(paragraphs), heading=heading))
                heading, paragraphs = line.lstrip("# ")[:240], []
            paragraphs.append(line)
        if paragraphs:
            sections.append(Section("\n".join(paragraphs), heading=heading))
    if not any(section.text.strip() for section in sections):
        raise ValueError("No extractable text found. Scanned PDFs require OCR, which is not supported")
    if sum(len(section.text) for section in sections) > 2_000_000:
        raise ValueError("Extracted text exceeds the 2 million character limit")
    return sections


def tokenize(text: str) -> list[int]:
    return tiktoken.get_encoding("cl100k_base").encode(text, disallowed_special=())


def chunk_sections(sections: list[Section], size: int = 500, overlap: int = 80) -> list[TextChunk]:
    if size <= 0 or not 0 <= overlap < size:
        raise ValueError("Require 0 <= overlap < chunk size")
    encoding = tiktoken.get_encoding("cl100k_base")
    result: list[TextChunk] = []
    seen: set[tuple[int | None, str | None, str]] = set()
    for section in sections:
        text = re.sub(r"\n{3,}", "\n\n", section.text.replace("\x00", "")).strip()
        tokens = tokenize(text)
        start = 0
        while start < len(tokens):
            end = min(start + size, len(tokens))
            # Favor paragraph or sentence boundaries in the last quarter of each chunk.
            if end < len(tokens):
                window = encoding.decode(tokens[start:end])
                boundary = max(window.rfind("\n\n"), window.rfind(". "))
                if boundary > len(window) * 0.75:
                    end = start + len(tokenize(window[: boundary + 1]))
            content = encoding.decode(tokens[start:end]).strip()
            key = (section.page, section.heading, content)
            if content and key not in seen:
                result.append(TextChunk(content, section.page, section.heading, start, end))
                seen.add(key)
            if end >= len(tokens):
                break
            start = max(start + 1, end - overlap)
    return result


def stored_path(key: str) -> Path:
    root = settings().storage_path.resolve()
    path = (root / key).resolve()
    if path.parent != root:
        raise ValueError("Invalid storage key")
    return path


def ingest(document_id: str) -> None:
    # Serialize retry/delete/reindex for this document. Commit only a complete replacement.
    with SessionLocal() as db:
        document = db.scalar(select(Document).where(Document.id == document_id).with_for_update())
        if not document or document.status == "deleted":
            return
        collection = db.get(Collection, document.collection_id)
        if not collection:
            return
        config = settings()
        if collection.embedding_identity != config.embedding_identity:
            document.status, document.error = (
                "failed",
                "Embedding configuration changed. Reindex the collection.",
            )
            db.commit()
            return
        try:
            document.status = "processing"
            db.commit()
            db.refresh(document, with_for_update=True)
            if document.status == "deleted":
                return
            db.refresh(collection)
            if collection.embedding_identity != config.embedding_identity:
                raise ValueError("Collection configuration changed. Retry after reindexing.")
            # Keep the row locked until ready to prevent deletion races.
            sections = extract(stored_path(document.storage_key), document.file_type)
            document.preview = "\n\n".join(s.text for s in sections)[:100000]
            pieces = chunk_sections(sections, config.chunk_tokens, config.chunk_overlap)
            if config.embedding_provider == "none" or not config.embedding_model:
                document.status, document.error = (
                    "awaiting_configuration",
                    "Configure embeddings and retry indexing",
                )
                db.commit()
                return
            vectors: list[list[float]] = []
            for start in range(0, len(pieces), 32):
                vectors.extend(asyncio.run(embed([piece.text for piece in pieces[start : start + 32]])))
            db.execute(delete(Chunk).where(Chunk.document_id == document.id))
            for i, (piece, vector) in enumerate(zip(pieces, vectors, strict=True)):
                db.add(
                    Chunk(
                        document_id=document.id,
                        workspace_id=document.workspace_id,
                        collection_id=document.collection_id,
                        position=i,
                        text=piece.text,
                        page=piece.page,
                        section=piece.section,
                        token_start=piece.token_start,
                        token_end=piece.token_end,
                        content_hash=hashlib.sha256(piece.text.encode()).hexdigest(),
                        embedding=vector,
                        embedding_identity=collection.embedding_identity,
                        index_version=collection.index_version,
                        search_vector=func.to_tsvector("english", piece.text),
                    )
                )
            document.chunk_count = len(pieces)
            document.embedding_identity = collection.embedding_identity
            document.index_version = collection.index_version
            document.status, document.error = "ready", None
            db.commit()
        except Exception as error:
            db.rollback()
            document = db.get(Document, document_id)
            if document and document.status != "deleted":
                job = get_current_job()
                document.status = "retrying" if job and job.retries_left else "failed"
                document.error = (
                    str(error)[:300]
                    if isinstance(error, (ValueError, UnicodeError))
                    else "Processing failed. Check worker connectivity and provider configuration."
                )
                db.commit()
            raise
