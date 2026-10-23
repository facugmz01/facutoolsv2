from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1)
    organization_name: str = Field(min_length=1, default="FacuTools")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AcceptInviteRequest(BaseModel):
    token: str
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)


class OrganizationOut(BaseModel):
    id: int
    name: str
    slug: str
    role_name: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    is_active: bool
    password_set: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MeResponse(BaseModel):
    user: UserOut
    organization: Optional[OrganizationOut] = None
    permissions: List[str] = Field(default_factory=list)
    bootstrap_required: bool = False


class AuthStatusResponse(BaseModel):
    bootstrap_required: bool
    authenticated: bool = False


class MemberOut(BaseModel):
    id: int
    user_id: int
    email: str
    name: str
    role_id: int
    role_name: str
    status: str
    created_at: datetime


class InviteCreate(BaseModel):
    email: EmailStr
    role_id: int


class InviteOut(BaseModel):
    id: int
    email: str
    role_id: int
    role_name: str
    expires_at: datetime
    invite_token: Optional[str] = None
    created_at: datetime


class MemberRoleUpdate(BaseModel):
    role_id: int


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    permission_codes: List[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permission_codes: Optional[List[str]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    is_system: bool
    permission_codes: List[str]
    created_at: datetime


class PermissionOut(BaseModel):
    code: str
    description: str


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None


class IdentityProviderCreate(BaseModel):
    name: str
    issuer_url: str
    client_id: str
    client_secret: str
    scopes: str = "openid email profile"
    enabled: bool = True
    auto_provision: bool = False
    default_role_id: Optional[int] = None


class IdentityProviderUpdate(BaseModel):
    name: Optional[str] = None
    issuer_url: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    scopes: Optional[str] = None
    enabled: Optional[bool] = None
    auto_provision: Optional[bool] = None
    default_role_id: Optional[int] = None


class IdentityProviderOut(BaseModel):
    id: int
    name: str
    type: str
    issuer_url: str
    client_id: str
    scopes: str
    enabled: bool
    auto_provision: bool
    default_role_id: Optional[int]
    created_at: datetime


class PublicSSOProvider(BaseModel):
    id: int
    name: str


class EntraOnboardingStart(BaseModel):
    name: str = Field(default="Microsoft Entra ID", min_length=1, max_length=255)
    auto_provision: bool = False


class EntraOnboardingStartOut(BaseModel):
    authorization_url: str
