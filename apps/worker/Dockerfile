FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY massefelt_worker ./massefelt_worker
RUN pip install --no-cache-dir . && useradd --system --uid 1001 worker
USER worker
CMD ["python", "-m", "massefelt_worker"]
