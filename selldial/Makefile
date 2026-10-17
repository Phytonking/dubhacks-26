.PHONY: dev test install

install:
	python -m pip install -r requirements.txt

dev:
	python -m uvicorn agent.server:app --reload --port 8000

test:
	python -m pytest -q
