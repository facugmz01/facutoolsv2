"""empty message"""

from alembic import op
import sqlalchemy as sa


revision = "001_rbac"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep this historical migration idempotent for databases that already use it.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "organizations" not in tables:
        op.create_table(
            "organizations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("slug", sa.String(100), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)

    if "permissions" not in tables:
        op.create_table(
            "permissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(100), nullable=False),
            sa.Column("description", sa.String(255), nullable=False),
        )
        op.create_index("ix_permissions_code", "permissions", ["code"], unique=True)

    if "roles" not in tables:
        op.create_table(
            "roles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("description", sa.String(255), nullable=True),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("organization_id", "name", name="uq_role_org_name"),
        )

    if "role_permissions" not in tables:
        op.create_table(
            "role_permissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), nullable=False),
            sa.Column("permission_id", sa.Integer(), sa.ForeignKey("permissions.id"), nullable=False),
            sa.UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
        )

    if "memberships" not in tables:
        op.create_table(
            "memberships",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("user_id", "organization_id", name="uq_membership_user_org"),
        )

    if "refresh_tokens" not in tables:
        op.create_table(
            "refresh_tokens",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("token_hash", sa.String(128), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)

    if "identity_providers" not in tables:
        op.create_table(
            "identity_providers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("type", sa.String(50), nullable=False, server_default="oidc"),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("client_id", sa.String(255), nullable=False),
            sa.Column("client_secret_enc", sa.Text(), nullable=False),
            sa.Column("issuer_url", sa.String(500), nullable=False),
            sa.Column("scopes", sa.String(255), nullable=False, server_default="openid email profile"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("auto_provision", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("default_role_id", sa.Integer(), sa.ForeignKey("roles.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    if "invitations" not in tables:
        op.create_table(
            "invitations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), nullable=False),
            sa.Column("token_hash", sa.String(128), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("accepted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_invitations_token_hash", "invitations", ["token_hash"], unique=True)

    # Add nullable org columns if missing (SQLite batch)
    def _add_col(table: str, column: str, col_type):
        cols = {c["name"] for c in inspector.get_columns(table)} if table in tables else set()
        if table in tables and column not in cols:
            with op.batch_alter_table(table) as batch:
                batch.add_column(sa.Column(column, col_type, nullable=True))

    if "users" in tables:
        cols = {c["name"] for c in inspector.get_columns("users")}
        with op.batch_alter_table("users") as batch:
            if "password_set" not in cols:
                batch.add_column(sa.Column("password_set", sa.Boolean(), server_default=sa.false()))
            if "is_active" not in cols:
                batch.add_column(sa.Column("is_active", sa.Boolean(), server_default=sa.true()))

    _add_col("domains", "organization_id", sa.Integer())
    _add_col("alerts", "organization_id", sa.Integer())
    _add_col("alert_rules", "organization_id", sa.Integer())
    _add_col("watchlist", "organization_id", sa.Integer())
    _add_col("ssl_certificates", "organization_id", sa.Integer())


def downgrade() -> None:
    pass
