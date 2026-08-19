"""Resting orders: pending_orders (limit/stop/bracket)

Revision ID: 0002_pending_orders
Revises: 0001_initial
Create Date: 2026-08-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_pending_orders"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pending_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("side", sa.String(length=4), nullable=False),
        sa.Column("kind", sa.String(length=6), nullable=False),
        sa.Column("role", sa.String(length=6), nullable=False, server_default="entry"),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("trigger_price", sa.Float(), nullable=False),
        sa.Column("bracket_id", sa.String(length=24), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="open"),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_pending_orders_account_id", "pending_orders", ["account_id"])
    op.create_index("ix_pending_orders_user_id", "pending_orders", ["user_id"])
    op.create_index("ix_pending_orders_symbol", "pending_orders", ["symbol"])
    op.create_index("ix_pending_orders_status", "pending_orders", ["status"])
    op.create_index("ix_pending_orders_bracket_id", "pending_orders", ["bracket_id"])
    op.create_index("ix_pending_orders_created_at", "pending_orders", ["created_at"])


def downgrade() -> None:
    op.drop_table("pending_orders")
