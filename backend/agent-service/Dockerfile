FROM python:3.12.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/pip pip install .

USER 65532:65532
CMD ["uvicorn", "moeazi_agent.api:app", "--host", "0.0.0.0", "--port", "8100"]
