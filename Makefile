start-backend:
	cd backend && ./venv/bin/python -m uvicorn main:app --reload --port 8000 --host 0.0.0.0

start-frontend:
	cd frontend && npm run dev -- --port 3000 --hostname 0.0.0.0

dev:
	make -j2 start-backend start-frontend

install:
	cd frontend && npm install
	cd backend && pip install -r requirements.txt

test-backend:
	curl http://localhost:8000/api/health
