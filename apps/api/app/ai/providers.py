import math
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import HTTPException
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, SecretStr

from app.core.config import settings


def validate_vectors(vectors: list[list[float]], expected_count: int, dimension: int) -> None:
    if len(vectors) != expected_count:
        raise ValueError("Embedding provider returned an incorrect number of vectors")
    for vector in vectors:
        if len(vector) != dimension or not all(math.isfinite(v) for v in vector):
            raise ValueError("Embedding dimensions or values do not match the collection configuration")
        if not any(v != 0 for v in vector):
            raise ValueError("Embedding provider returned a zero vector")


async def embed(texts: list[str]) -> list[list[float]]:
    config = settings()
    if config.embedding_provider == "none" or not config.embedding_model:
        raise ValueError("Configure an embedding provider and model, then retry indexing")
    async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
        if config.embedding_provider == "openai":
            if not config.openai_api_key:
                raise ValueError("OpenAI credentials are missing")
            response = await client.post(
                f"{config.openai_base_url.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {config.openai_api_key}"},
                json={"model": config.embedding_model, "input": texts},
            )
            response.raise_for_status()
            vectors = [
                item["embedding"] for item in sorted(response.json()["data"], key=lambda x: x["index"])
            ]
        else:
            response = await client.post(
                f"{config.ollama_base_url.rstrip('/')}/api/embed",
                json={"model": config.embedding_model, "input": texts, "truncate": False},
            )
            response.raise_for_status()
            vectors = response.json()["embeddings"]
    validate_vectors(vectors, len(texts), config.embedding_dimension)
    return vectors


class ModelProvider:
    """One model integration for chat and bounded structured workflows. URLs are server configuration only."""

    def __init__(self) -> None:
        config = settings()
        if config.ai_provider == "none" or not config.chat_model:
            raise HTTPException(503, "Configure a chat provider and model in the server environment")
        self.model: ChatOpenAI | ChatOllama
        if config.ai_provider == "openai":
            if not config.openai_api_key:
                raise HTTPException(503, "OpenAI credentials are missing")
            self.model = ChatOpenAI(
                model=config.chat_model,
                api_key=SecretStr(config.openai_api_key),
                base_url=config.openai_base_url,
                timeout=90,
                max_retries=1,
                max_completion_tokens=config.max_output_tokens,
            )
        else:
            self.model = ChatOllama(
                model=config.chat_model,
                base_url=config.ollama_base_url,
                num_predict=config.max_output_tokens,
                num_ctx=config.model_context_tokens,
                client_kwargs={"timeout": 90},
            )
        self.usage: dict[str, Any] = {}

    async def stream(self, messages: list[BaseMessage]) -> AsyncIterator[str]:
        async for chunk in self.model.astream(messages):
            if chunk.usage_metadata:
                self.usage = dict(chunk.usage_metadata)
            if isinstance(chunk.content, str):
                yield chunk.content

    async def structured(self, messages: list[BaseMessage], schema: type[BaseModel]) -> BaseModel:
        if not settings().model_supports_structured:
            raise HTTPException(503, "Structured output support must be verified and enabled for this model")
        result = await self.model.with_structured_output(schema, method="json_schema").ainvoke(messages)
        return schema.model_validate(result)

    async def search_tool_call(self, question: str) -> dict[str, Any]:
        if not settings().model_supports_tools:
            raise HTTPException(503, "Tool calling support has not been verified for this model")
        tool = {
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search the current authorized knowledge scope using a focused retrieval query.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        }
        message = await self.model.bind_tools([tool]).ainvoke(
            [
                SystemMessage(
                    content="Call search_knowledge exactly once with a focused query for the user's question. Do not answer the question yet."
                ),
                HumanMessage(content=question),
            ]
        )
        calls = getattr(message, "tool_calls", [])
        if len(calls) != 1 or calls[0]["name"] != "search_knowledge":
            raise ValueError("Model did not return one supported read-only tool call")
        return calls[0]["args"]


async def provider_health() -> dict[str, Any]:
    config = settings()
    result: dict[str, Any] = {
        "test_mode": config.test_mode,
        "provider": config.ai_provider,
        "model": config.chat_model or None,
        "chat": "unconfigured",
        "embeddings": "unconfigured",
        "embedding_model": config.embedding_model or None,
        "dimension": config.embedding_dimension,
        "structured": config.model_supports_structured,
        "tools": config.model_supports_tools,
    }
    # A successful model listing proves connectivity/model presence, not generation capability.
    async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
        for kind, provider, model in [
            ("chat", config.ai_provider, config.chat_model),
            ("embeddings", config.embedding_provider, config.embedding_model),
        ]:
            if provider == "none" or not model:
                continue
            try:
                if provider == "openai":
                    if not config.openai_api_key:
                        result[kind] = "credentials_missing"
                        continue
                    response = await client.get(
                        f"{config.openai_base_url.rstrip('/')}/models/{model}",
                        headers={"Authorization": f"Bearer {config.openai_api_key}"},
                    )
                else:
                    response = await client.post(
                        f"{config.ollama_base_url.rstrip('/')}/api/show", json={"model": model}
                    )
                response.raise_for_status()
                result[kind] = "connected"
                if provider == "ollama":
                    capabilities = response.json().get("capabilities", [])
                    if capabilities and (
                        (kind == "embeddings" and "embedding" not in capabilities)
                        or (kind == "chat" and "completion" not in capabilities)
                    ):
                        result[kind] = "unsupported_model"
            except (httpx.HTTPError, ValueError):
                result[kind] = "unavailable"
    return result
