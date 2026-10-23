from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthContext, require_permissions
from app.database import get_db
from app.models import WatchlistItem
from app.schemas import WatchlistCreate

router = APIRouter()


@router.get("")
async def list_watchlist(
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("watchlist:read")),
):
    result = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.organization_id == ctx.organization_id)
        .order_by(WatchlistItem.created_at.desc())
    )
    items = result.scalars().all()
    return [
        {
            "id": i.id, "domain_name": i.domain_name, "target_price": i.target_price,
            "notes": i.notes, "is_available": i.is_available, "created_at": i.created_at,
        }
        for i in items
    ]


@router.post("", status_code=201)
async def add_to_watchlist(
    data: WatchlistCreate,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("watchlist:write")),
):
    item = WatchlistItem(
        organization_id=ctx.organization_id,
        domain_name=data.domain_name.lower().strip(),
        target_price=data.target_price,
        notes=data.notes,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "domain_name": item.domain_name}


@router.delete("/{item_id}", status_code=204)
async def remove_from_watchlist(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: AuthContext = Depends(require_permissions("watchlist:write")),
):
    result = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.id == item_id,
            WatchlistItem.organization_id == ctx.organization_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
