import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.security import create_access_token
from app.database import Base, async_session, engine, init_db
from app.main import app


client = TestClient(app)


def test_init_db_creates_schema_on_clean_database():
    async def run_check():
        async with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(text(f'DROP TABLE IF EXISTS "{table.name}"'))

        await init_db()

        async with async_session() as session:
            result = await session.execute(text('SELECT 1 FROM app_settings LIMIT 1'))
            assert result.first() is not None

    asyncio.run(run_check())


def test_create_access_token_works_without_loaded_settings():
    token = create_access_token(42)
    assert isinstance(token, str)
    assert token


def test_domains_rejects_missing_authentication():
    response = client.get("/api/domains")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_settings_rejects_missing_authentication():
    response = client.get("/api/settings")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"