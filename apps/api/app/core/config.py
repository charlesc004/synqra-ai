from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://synqra:local-development-only@localhost:5432/synqra"
    redis_url: str = "redis://localhost:6379/0"
    app_origin: str = "http://localhost:3000"
    cookie_secure: bool = False
    storage_path: Path = Path("storage")
    ai_provider: Literal["none", "openai", "ollama"] = "none"
    chat_model: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    ollama_base_url: str = "http://localhost:11434"
    embedding_provider: Literal["none", "openai", "ollama"] = "none"
    embedding_model: str = ""
    embedding_dimension: int = Field(default=768, ge=1, le=2000)
    model_supports_structured: bool = False
    model_supports_tools: bool = False
    max_upload_mb: int = Field(default=15, ge=1, le=50)
    chunk_tokens: int = Field(default=500, ge=100, le=2000)
    chunk_overlap: int = Field(default=80, ge=0)
    context_tokens: int = Field(default=6000, ge=500, le=24000)
    model_context_tokens: int = Field(default=16384, ge=4096, le=131072)
    max_output_tokens: int = Field(default=2048, ge=256, le=8192)
    retrieval_k: int = Field(default=6, ge=1, le=20)
    semantic_candidates: int = Field(default=30, ge=1, le=100)
    keyword_candidates: int = Field(default=30, ge=1, le=100)
    rerank: bool = False
    seed_password: str = ""
    test_mode: bool = False

    @model_validator(mode="after")
    def validate_overlap(self) -> "Settings":
        if self.chunk_overlap >= self.chunk_tokens:
            raise ValueError("Chunk overlap must be smaller than chunk size")
        if self.max_output_tokens + 2000 >= self.model_context_tokens:
            raise ValueError("Model context must leave room for evidence, history, and output")
        return self

    @property
    def embedding_identity(self) -> str:
        return f"{self.embedding_provider}:{self.embedding_model}:{self.embedding_dimension}"


@lru_cache
def settings() -> Settings:
    return Settings()
