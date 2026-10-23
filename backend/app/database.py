from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL


def _engine_kwargs(url: str) -> dict:
    """Tune the async engine per dialect."""
    kwargs: dict = {"echo": False}
    if url.startswith("postgresql"):
        kwargs.update(
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
    return kwargs


engine = create_async_engine(DATABASE_URL, **_engine_kwargs(DATABASE_URL))
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    from app.settings_store import SettingsStore
    from app.auth.bootstrap import backfill_default_organization, seed_permissions

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_monitor_columns)
        await conn.run_sync(_add_domain_monitor_columns)

    async with async_session() as session:
        await SettingsStore.load(session)
        await seed_permissions(session)
        await backfill_default_organization(session)


def _add_domain_monitor_columns(sync_conn) -> None:
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    if "domains" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("domains")}
    if "monitor_method" not in columns:
        sync_conn.execute(text("ALTER TABLE domains ADD COLUMN monitor_method VARCHAR(20) NOT NULL DEFAULT 'http'"))
    if "monitor_port" not in columns:
        sync_conn.execute(text("ALTER TABLE domains ADD COLUMN monitor_port INTEGER"))


def _add_monitor_columns(sync_conn) -> None:
    """Keep existing installations compatible with newer monitor fields."""
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    if "monitor_targets" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("monitor_targets")}
    additions = {
        "keyword": "VARCHAR(255)",
        "soap_action": "VARCHAR(500)",
        "request_body": "TEXT",
        "interval_seconds": "INTEGER",
        "warning_threshold_ms": "INTEGER",
        "critical_threshold_ms": "INTEGER",
    }
    for column, column_type in additions.items():
        if column not in columns:
            sync_conn.execute(text(f"ALTER TABLE monitor_targets ADD COLUMN {column} {column_type}"))
