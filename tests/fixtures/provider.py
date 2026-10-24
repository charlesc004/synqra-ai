"""Deterministic OpenAI-compatible HTTP fixture for E2E only. Never imported by application code."""

import hashlib
import json
import re
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
failed_embedding_inputs: set[str] = set()


@app.get("/v1/models/{model}")
def model_info(model: str):
    return {"id": model, "object": "model", "owned_by": "synqra-tests"}


@app.post("/v1/embeddings")
def embeddings(body: dict):
    inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
    vectors = []
    for value in inputs:
        if "fixture:embedding-retry" in value and value not in failed_embedding_inputs:
            failed_embedding_inputs.add(value)
            return JSONResponse(
                status_code=503,
                content={"error": "Controlled transient embedding failure"},
            )
        # Shared baseline ensures retrieval candidates; token features give deterministic ordering.
        vector = [0.0] * 768
        vector[0] = 2.0
        for term in set(re.findall(r"[a-z]+", value.lower())):
            slot = 1 + int(hashlib.sha256(term.encode()).hexdigest()[:8], 16) % 767
            vector[slot] += 0.1
        vectors.append(vector)
    return {
        "object": "list",
        "data": [
            {"object": "embedding", "index": i, "embedding": v}
            for i, v in enumerate(vectors)
        ],
        "model": body["model"],
        "usage": {"prompt_tokens": 10, "total_tokens": 10},
    }


@app.post("/v1/chat/completions")
def completion(body: dict):
    identifier = "chatcmpl-" + uuid4().hex
    model = body["model"]
    content = body.get("messages", [{}])[-1].get("content", "") or ""
    question = content.split("QUESTION:")[-1]
    if "fixture:provider-error" in question:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Controlled provider failure",
                    "type": "server_error",
                }
            },
        )
    if body.get("tools"):
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-test",
                    "type": "function",
                    "function": {
                        "name": "search_knowledge",
                        "arguments": json.dumps({"query": "remote work policy"}),
                    },
                }
            ],
        }
    elif body.get("response_format"):
        schema = body["response_format"].get("json_schema", {}).get("schema", {})
        properties = schema.get("properties", {})
        if "source_labels" in properties and "description" in properties:
            result = {
                "title": "Review the security policy",
                "description": "Review documented access controls with the IT team.",
                "source_labels": ["S1"],
            }
        elif "similarities" in properties:
            result = {
                "summary": "Controlled fixture comparison",
                "similarities": ["Both policies require individual accounts."],
                "differences": ["Review interval changed from 90 days to 30 days."],
                "conflicts": [],
                "manual_review": [],
                "source_labels": ["S1", "S2"],
            }
        else:
            result = {
                "title": "Extracted fixture document",
                "organization": "Northstar Digital Operations",
                "summary": "Controlled extraction fixture.",
                "important_dates": [],
                "obligations": [],
                "action_items": [],
                "contacts": [],
                "source_labels": ["S1"],
            }
        message = {"role": "assistant", "content": json.dumps(result)}
    else:
        message = {
            "role": "assistant",
            "content": "Controlled test answer: the source documents describe the remote-work policy and its requirements. [S1]",
        }
        if "fixture:invalid-citation" in question:
            message["content"] = (
                "This intentionally invalid test answer cites an unknown source. [S999]"
            )
    if body.get("stream"):

        def events():
            for text in re.findall(r".{1,12}", message["content"]):
                if "fixture:slow" in question:
                    import time

                    time.sleep(0.15)
                frame = {
                    "id": identifier,
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": model,
                    "choices": [
                        {"index": 0, "delta": {"content": text}, "finish_reason": None}
                    ],
                }
                yield f"data: {json.dumps(frame)}\n\n"
            yield f"data: {json.dumps({'id': identifier, 'object': 'chat.completion.chunk', 'created': 0, 'model': model, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 20, 'completion_tokens': 30, 'total_tokens': 50}})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")
    return {
        "id": identifier,
        "object": "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if body.get("tools") else "stop",
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 30, "total_tokens": 50},
    }
