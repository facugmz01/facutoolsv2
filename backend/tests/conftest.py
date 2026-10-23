import os


os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("CLIENT_SECRET_ENCRYPTION_KEY", "test-client-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test-domaintools.db")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")