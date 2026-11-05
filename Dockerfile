FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir --default-timeout=180 --retries=10 -r requirements.txt

COPY . .

RUN mkdir -p data/incoming data/backups data/processed

EXPOSE 5000

CMD ["python", "deploy.py"]
