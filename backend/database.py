from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("STRATEGY_SANDBOX_DATA_DIR", ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'strategy_sandbox.db').as_posix()}")


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Experiment(Base):
    __tablename__ = "experiments"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    dataset_version: Mapped[str] = mapped_column(String(80))
    seed: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    workflow: Mapped[dict] = mapped_column(JSON, default=dict)
    active_claim_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active_snapshot_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    active_strategy_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    active_run_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    connection_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Claim(Base):
    __tablename__ = "claims"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    policy_id: Mapped[str] = mapped_column(String(64), index=True)
    pet_id: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[str] = mapped_column(String(64))
    pet_name: Mapped[str] = mapped_column(String(80), index=True)
    species: Mapped[str] = mapped_column(String(32))
    breed: Mapped[str] = mapped_column(String(80))
    region: Mapped[str] = mapped_column(String(32), index=True)
    hospital: Mapped[str] = mapped_column(String(120))
    disease_code: Mapped[str] = mapped_column(String(64), index=True)
    disease: Mapped[str] = mapped_column(String(80))
    claim_amount_cents: Mapped[int] = mapped_column(Integer)
    covered_expense_cents: Mapped[int] = mapped_column(Integer)
    deductible_cents: Mapped[int] = mapped_column(Integer)
    reimbursement_bps: Mapped[int] = mapped_column(Integer)
    remaining_limit_cents: Mapped[int] = mapped_column(Integer)
    material_complete: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ocr_confidence_bps: Mapped[int] = mapped_column(Integer)
    image_compliance: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admission_date: Mapped[str] = mapped_column(String(16))
    line_items: Mapped[list] = mapped_column(JSON, default=list)
    risk_facts: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    evidence_items: Mapped[list["EvidenceItem"]] = relationship(back_populates="claim", cascade="all, delete-orphan")


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    claim_id: Mapped[str] = mapped_column(ForeignKey("claims.id"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(60))
    file_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_hash: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    confidence_bps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recognition_result: Mapped[dict] = mapped_column(JSON, default=dict)
    structured_fact: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="REGISTERED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    claim: Mapped[Claim] = relationship(back_populates="evidence_items")
    reviews: Mapped[list["ImageReview"]] = relationship(back_populates="evidence", cascade="all, delete-orphan")


class ImageReview(Base):
    __tablename__ = "image_reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    evidence_id: Mapped[str] = mapped_column(ForeignKey("evidence_items.id"), index=True)
    status: Mapped[str] = mapped_column(String(32))
    tag_code: Mapped[str] = mapped_column(String(64))
    tag_label: Mapped[str] = mapped_column(String(100))
    comment: Mapped[str] = mapped_column(Text, default="")
    reviewer: Mapped[str] = mapped_column(String(80), default="演示审核员")
    version: Mapped[int] = mapped_column(Integer)
    source_hash: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    evidence: Mapped[EvidenceItem] = relationship(back_populates="reviews")


class DataConnection(Base):
    __tablename__ = "data_connections"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    business_type: Mapped[str] = mapped_column(String(32))
    connector_type: Mapped[str] = mapped_column(String(40))
    endpoint_masked: Mapped[str] = mapped_column(String(255))
    match_key: Mapped[str] = mapped_column(String(40))
    match_method: Mapped[str] = mapped_column(String(255))
    confidence_bps: Mapped[int] = mapped_column(Integer)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    data_version: Mapped[str] = mapped_column(String(80))
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    fingerprint: Mapped[str] = mapped_column(String(80), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="CONNECTED")


class PlatformRecord(Base):
    __tablename__ = "platform_records"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    connection_id: Mapped[str] = mapped_column(ForeignKey("data_connections.id"), index=True)
    category: Mapped[str] = mapped_column(String(100))
    event_time: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text)
    local_id_masked: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class OntologyEntity(Base):
    __tablename__ = "ontology_entities"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(60), index=True)
    label: Mapped[str] = mapped_column(String(160))
    local_id_masked: Mapped[str] = mapped_column(String(100))
    platform_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")


class OntologyRelation(Base):
    __tablename__ = "ontology_relations"
    id: Mapped[str] = mapped_column(String(140), primary_key=True)
    from_entity_id: Mapped[str] = mapped_column(String(120), index=True)
    to_entity_id: Mapped[str] = mapped_column(String(120), index=True)
    relation_type: Mapped[str] = mapped_column(String(80))
    match_method: Mapped[str] = mapped_column(String(255))
    confidence_bps: Mapped[int] = mapped_column(Integer)
    evidence: Mapped[str] = mapped_column(Text)
    effective_period: Mapped[str] = mapped_column(String(100))
    confirmation_status: Mapped[str] = mapped_column(String(40), default="MATCHED")


class FactSnapshot(Base):
    __tablename__ = "fact_snapshots"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id"), index=True)
    content_hash: Mapped[str] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="FROZEN")
    payload: Mapped[dict] = mapped_column(JSON)
    versions: Mapped[dict] = mapped_column(JSON)
    frozen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Strategy(Base):
    __tablename__ = "strategies"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id"), index=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("fact_snapshots.id"), index=True)
    version: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(32), default="CONFIRMED")
    source_text: Mapped[str] = mapped_column(Text)
    model_output: Mapped[dict] = mapped_column(JSON, default=dict)
    rule: Mapped[dict] = mapped_column(JSON)
    human_amendments: Mapped[list] = mapped_column(JSON, default=list)
    parse_source: Mapped[str] = mapped_column(String(32))
    parser_version: Mapped[str] = mapped_column(String(80))
    model_name: Mapped[str] = mapped_column(String(120), default="")
    model_request_id: Mapped[str] = mapped_column(String(120), default="")
    actor: Mapped[str] = mapped_column(String(80), default="演示用户")
    rule_hash: Mapped[str] = mapped_column(String(80), index=True)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StrategyValidation(Base):
    __tablename__ = "strategy_validations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    strategy_id: Mapped[str] = mapped_column(ForeignKey("strategies.id"), index=True)
    checks: Mapped[list] = mapped_column(JSON)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SimulationRun(Base):
    __tablename__ = "simulation_runs"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id"), index=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("fact_snapshots.id"), index=True)
    strategy_id: Mapped[str] = mapped_column(ForeignKey("strategies.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    rule_hash: Mapped[str] = mapped_column(String(80), index=True)
    metrics: Mapped[dict] = mapped_column(JSON)
    distribution: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SimulationCase(Base):
    __tablename__ = "simulation_cases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("simulation_runs.id"), index=True)
    claim_id: Mapped[str] = mapped_column(ForeignKey("claims.id"), index=True)
    changed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    old_decision: Mapped[dict] = mapped_column(JSON)
    new_decision: Mapped[dict] = mapped_column(JSON)
    payout_delta_cents: Mapped[int] = mapped_column(Integer)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str] = mapped_column(String(120))
    actor: Mapped[str] = mapped_column(String(80), default="演示用户")
    revision: Mapped[int] = mapped_column(Integer)
    before_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    after_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    from .domain import seed_database

    with SessionLocal() as session:
        if session.get(Experiment, "pet-gi-demo") is None:
            seed_database(session)
            session.commit()

