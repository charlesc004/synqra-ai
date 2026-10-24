FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TIKTOKEN_CACHE_DIR=/opt/tiktoken
WORKDIR /workspace
RUN python -m pip install --no-cache-dir "pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70"
COPY apps/api /workspace/apps/api
RUN pip install --no-cache-dir /workspace/apps/api && python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
COPY datasets /workspace/datasets
RUN useradd --create-home --uid 10001 synqra && mkdir -p /workspace/storage && chown -R synqra:synqra /workspace/storage
USER synqra
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
