from __future__ import annotations

import mimetypes
import hashlib
from contextlib import asynccontextmanager
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .database import (
    ROOT,
    DATA_DIR,
    UPLOAD_DIR,
    AuditEvent,
    Claim,
    DataConnection,
    EvidenceItem,
    Experiment,
    FactSnapshot,
    ImageReview,
    OntologyEntity,
    OntologyRelation,
    PlatformRecord,
    SessionLocal,
    SimulationCase,
    SimulationRun,
    Strategy,
    StrategyValidation,
    init_database,
    utcnow,
)
from .domain import (
    DATASET_VERSION,
    EXPERIMENT_ID,
    PARSER_VERSION,
    audit,
    bump_revision,
    canonical,
    claim_to_dict,
    connection_to_dict,
    default_candidate_rule,
    evidence_to_dict,
    invalidate,
    iso,
    parse_local_rule,
    reset_database,
    review_to_dict,
    simulate_claims,
    stable_hash,
    validate_rule,
    yuan,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_database()
    yield


app = FastAPI(title="Strategy Sandbox API", version="20.0.0", lifespan=lifespan)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"ok": False, "error": {"code": exc.code, "message": exc.message, "details": exc.details}})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"ok": False, "error": {"code": "INVALID_REQUEST", "message": "请求参数不完整或格式错误", "details": exc.errors()}})


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"ok": False, "error": {"code": "INTERNAL_ERROR", "message": "服务处理失败", "details": str(exc) if os.getenv("APP_DEBUG") == "1" else None}})




def ok(data: Any = None, **extra: Any) -> dict:
    return {"ok": True, "data": data, **extra}


def session_scope():
    return SessionLocal()


def experiment(session: Session) -> Experiment:
    exp = session.get(Experiment, EXPERIMENT_ID)
    if not exp:
        raise ApiError(500, "EXPERIMENT_MISSING", "演示实验尚未初始化")
    return exp


def require_revision(exp: Experiment, payload: dict) -> None:
    supplied = payload.get("experimentRevision")
    if supplied is None:
        raise ApiError(409, "STALE_STATE", "缺少实验修订号，请刷新后重试", {"currentRevision": exp.revision})
    if int(supplied) != exp.revision:
        raise ApiError(409, "STALE_STATE", "页面状态已被其他操作更新，请刷新后重试", {"currentRevision": exp.revision, "suppliedRevision": supplied})


def require_flow(exp: Experiment, key: str, message: str) -> None:
    if not (exp.workflow or {}).get(key):
        raise ApiError(409, "WORKFLOW_GUARD", message, {"required": key, "workflow": exp.workflow})


def workflow_set(exp: Experiment, **values: bool) -> None:
    current = dict(exp.workflow or {})
    current.update(values)
    exp.workflow = current


def serialize_strategy(item: Strategy) -> dict:
    return {
        **item.rule,
        "strategyId": item.id,
        "version": item.version,
        "status": item.status,
        "sourceText": item.source_text,
        "parseSource": item.parse_source,
        "parserVersion": item.parser_version,
        "modelName": item.model_name,
        "modelRequestId": item.model_request_id,
        "ruleHash": item.rule_hash,
        "factSnapshotHash": item.rule.get("factSnapshotHash", ""),
        "confirmedAt": iso(item.confirmed_at),
    }


def serialize_snapshot(item: FactSnapshot) -> dict:
    return {"id": item.id, "hash": item.content_hash, "status": item.status, "payload": item.payload, "versions": item.versions, "frozenAt": iso(item.frozen_at)}


def serialize_validation(item: StrategyValidation | None) -> dict | None:
    if not item:
        return None
    return {"id": item.id, "strategyId": item.strategy_id, "checks": item.checks, "passed": item.passed, "confirmed": item.confirmed, "confirmedAt": iso(item.confirmed_at)}


def simulation_case_dict(item: SimulationCase, claim: Claim) -> dict:
    return {
        **claim_to_dict(claim),
        "claim": claim_to_dict(claim),
        "changed": item.changed,
        "oldDecision": item.old_decision,
        "newDecision": item.new_decision,
        "old": item.old_decision,
        "new": item.new_decision,
        "payoutDelta": yuan(item.payout_delta_cents),
        "payoutDeltaCents": item.payout_delta_cents,
    }


def serialize_run(session: Session, run: SimulationRun, include_cases: bool = False) -> dict:
    result = {
        "id": run.id,
        "runId": run.id,
        "snapshot": run.snapshot_id,
        "strategyId": run.strategy_id,
        "status": run.status,
        "ruleHash": run.rule_hash,
        "hash": session.get(FactSnapshot, run.snapshot_id).content_hash if session.get(FactSnapshot, run.snapshot_id) else "",
        "timestamp": iso(run.created_at),
        "metrics": run.metrics,
        "distribution": run.distribution,
        **run.metrics,
    }
    if include_cases:
        rows = session.execute(select(SimulationCase, Claim).join(Claim, Claim.id == SimulationCase.claim_id).where(SimulationCase.run_id == run.id).order_by(SimulationCase.id)).all()
        result["rows"] = [simulation_case_dict(case, claim) for case, claim in rows]
    return result


def public_app_state(session: Session) -> dict:
    exp = experiment(session)
    claims = session.scalars(select(Claim).order_by(Claim.id)).all()
    reviews = session.scalars(select(ImageReview).order_by(ImageReview.id)).all()
    connections = session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED").order_by(DataConnection.synced_at)).all()
    snapshot = session.get(FactSnapshot, exp.active_snapshot_id) if exp.active_snapshot_id else None
    strategy = session.get(Strategy, exp.active_strategy_id) if exp.active_strategy_id else None
    run = session.get(SimulationRun, exp.active_run_id) if exp.active_run_id else None
    validation = None
    if strategy:
        validation = session.scalars(select(StrategyValidation).where(StrategyValidation.strategy_id == strategy.id).order_by(StrategyValidation.id.desc())).first()
    return {
        "experiment": {"id": exp.id, "name": exp.name, "revision": exp.revision, "datasetVersion": exp.dataset_version, "seed": exp.seed},
        "workflow": exp.workflow,
        "activeClaimId": exp.active_claim_id,
        "claims": [claim_to_dict(item) for item in claims],
        "reviews": {review.evidence_id: review_to_dict(review) for review in reviews},
        "connections": [connection_to_dict(item) for item in connections],
        "snapshot": serialize_snapshot(snapshot) if snapshot else None,
        "candidateRule": serialize_strategy(strategy) if strategy else default_candidate_rule(),
        "validation": serialize_validation(validation),
        "run": serialize_run(session, run, include_cases=True) if run else None,
    }


@app.get("/api/health")
def health():
    with session_scope() as session:
        exp = experiment(session)
        return ok({"status": "ready", "version": "20.0.0", "database": "sqlite" if str(session.bind.url).startswith("sqlite") else "postgresql", "revision": exp.revision})


@app.get("/api/app-state")
def app_state():
    with session_scope() as session:
        return ok(public_app_state(session))


@app.post("/api/demo/reset")
def demo_reset(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        reset_database(session)
        session.commit()
        return ok(public_app_state(session))


@app.get("/api/claims")
def list_claims(q: str = "", limit: int = 320, offset: int = 0):
    with session_scope() as session:
        stmt = select(Claim)
        if q:
            pattern = f"%{q.strip()}%"
            stmt = stmt.where(or_(Claim.id.like(pattern), Claim.policy_id.like(pattern), Claim.pet_name.like(pattern)))
        rows = session.scalars(stmt.order_by(Claim.id).offset(max(0, offset)).limit(min(320, max(1, limit)))).all()
        return ok({"items": [claim_to_dict(item) for item in rows], "total": len(rows)})


@app.get("/api/claims/{claim_id}")
def get_claim(claim_id: str):
    with session_scope() as session:
        claim = session.scalar(select(Claim).options(selectinload(Claim.evidence_items)).where(Claim.id == claim_id))
        if not claim:
            raise ApiError(404, "CLAIM_NOT_FOUND", "理赔案件不存在")
        reviews = session.scalars(select(ImageReview).join(EvidenceItem).where(EvidenceItem.claim_id == claim_id).order_by(ImageReview.id)).all()
        return ok({**claim_to_dict(claim, include_evidence=True), "imageReviews": [review_to_dict(item) for item in reviews]})


ALLOWED_UPLOADS = {"image/png", "image/jpeg", "image/webp", "application/pdf"}


@app.post("/api/claims/{claim_id}/evidence")
async def upload_evidence(claim_id: str, file: UploadFile = File(...), evidenceType: str = Form(...), experimentRevision: int = Form(...)):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, {"experimentRevision": experimentRevision})
        claim = session.get(Claim, claim_id)
        if not claim:
            raise ApiError(404, "CLAIM_NOT_FOUND", "理赔案件不存在")
        mime = (file.content_type or mimetypes.guess_type(file.filename or "")[0] or "").lower()
        if mime not in ALLOWED_UPLOADS:
            raise ApiError(415, "UNSUPPORTED_FILE", "仅支持PNG、JPEG、WebP和PDF")
        raw = await file.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise ApiError(413, "FILE_TOO_LARGE", "单个文件不能超过10MB")
        digest = hashlib.sha256(raw).hexdigest()
        duplicate = session.scalar(select(EvidenceItem).where(EvidenceItem.claim_id == claim_id, EvidenceItem.source_hash == digest))
        if duplicate:
            raise ApiError(409, "DUPLICATE_EVIDENCE", "该材料已上传", {"evidenceId": duplicate.id})
        suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf"}[mime]
        item_id = f"EV-UP-{stable_hash(claim_id + digest, 16)}"
        claim_dir = UPLOAD_DIR / stable_hash(claim_id, 16)
        claim_dir.mkdir(parents=True, exist_ok=True)
        storage = claim_dir / f"{item_id}{suffix}"
        storage.write_bytes(raw)
        is_image_review = evidenceType == "diagnostic_image"
        item = EvidenceItem(
            id=item_id, claim_id=claim_id, evidence_type=evidenceType, file_name=Path(file.filename or f"material{suffix}").name,
            mime_type=mime, storage_path=str(storage.relative_to(DATA_DIR)), source_hash=digest, size_bytes=len(raw), confidence_bps=None if is_image_review else 8600,
            recognition_result={} if is_image_review else {"label": "本地演示OCR", "text": "已完成材料登记与结构化识别"},
            structured_fact={} if is_image_review else {"registered": True}, status="REGISTERED",
        )
        session.add(item)
        invalidate(session, exp, "materials")
        bump_revision(exp)
        audit(session, exp, "EVIDENCE_UPLOADED", "evidence", item.id, {"claimId": claim_id, "type": evidenceType, "mime": mime, "size": len(raw)})
        session.commit()
        return ok({"evidence": evidence_to_dict(item), "experimentRevision": exp.revision})


@app.post("/api/claims/{claim_id}/materials/confirm")
def confirm_claim_materials(claim_id: str, payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        if not session.get(Claim, claim_id):
            raise ApiError(404, "CLAIM_NOT_FOUND", "理赔案件不存在")
        text_count = session.scalar(select(func.count()).select_from(EvidenceItem).where(EvidenceItem.claim_id == claim_id, EvidenceItem.evidence_type != "diagnostic_image"))
        if not text_count:
            raise ApiError(409, "TEXT_EVIDENCE_REQUIRED", "请先登记至少一份文本材料")
        invalidate(session, exp, "materials")
        workflow_set(exp, materialsRegistered=True, ocrValidated=True, imageReviewComplete=False)
        bump_revision(exp)
        audit(session, exp, "MATERIALS_CONFIRMED", "claim", claim_id, {"textEvidenceCount": text_count})
        session.commit()
        return ok({"workflow": exp.workflow, "experimentRevision": exp.revision})


@app.post("/api/evidence/{evidence_id}/image-reviews")
def save_image_review(evidence_id: str, payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        item = session.get(EvidenceItem, evidence_id)
        if not item or item.evidence_type != "diagnostic_image":
            raise ApiError(404, "IMAGE_EVIDENCE_NOT_FOUND", "诊疗图片不存在")
        status = payload.get("status")
        tag_code = str(payload.get("tagCode") or "").strip()
        comment = str(payload.get("comment") or "").strip()
        if status not in {"PASS", "FAIL", "NEEDS_REVIEW"} or not tag_code:
            raise ApiError(422, "IMAGE_REVIEW_INVALID", "审核结论和问题标签为必填项")
        if status != "PASS" and not comment:
            raise ApiError(422, "IMAGE_REVIEW_COMMENT_REQUIRED", "不通过或待复核时必须填写人工审核意见")
        latest = session.scalars(select(ImageReview).where(ImageReview.evidence_id == evidence_id).order_by(ImageReview.version.desc())).first()
        review = ImageReview(
            evidence_id=evidence_id, status=status, tag_code=tag_code, tag_label=str(payload.get("tagLabel") or tag_code), comment=comment,
            reviewer=str(payload.get("reviewer") or "演示审核员"), version=(latest.version + 1 if latest else 1), source_hash=item.source_hash,
        )
        session.add(review)
        claim = session.get(Claim, item.claim_id)
        claim.image_compliance = status
        workflow_set(exp, materialsRegistered=True, ocrValidated=True, imageReviewComplete=True)
        invalidate(session, exp, "materials")
        workflow_set(exp, materialsRegistered=True, ocrValidated=True, imageReviewComplete=True)
        bump_revision(exp)
        audit(session, exp, "IMAGE_REVIEW_SAVED", "evidence", evidence_id, {"status": status, "tag": tag_code, "version": review.version})
        session.commit()
        session.refresh(review)
        return ok({"review": review_to_dict(review), "workflow": exp.workflow, "experimentRevision": exp.revision})


def connection_templates(business_type: str) -> list[dict]:
    templates = {
        "medical": [("就诊记录", 8), ("诊断", 5), ("检验", 12), ("费用票据", 6)],
        "insurance": [("投保信息", 2), ("历史理赔", 4), ("保单", 2)],
        "payment": [("支付订单", 9), ("退款", 1), ("收款账户", 2)],
        "registry": [("宠物身份", 2), ("芯片", 1), ("家系关系", 5)],
        "other": [("身份记录", 2), ("业务事件", 6)],
    }
    return [{"name": name, "recordCount": count} for name, count in templates.get(business_type, templates["other"])]


TEST_TOKENS: dict[str, dict] = {}


def mask_endpoint(value: str) -> str:
    parsed = urlparse(value if "://" in value else f"tcp://{value}")
    host = parsed.hostname or "local"
    masked_host = host[:3] + "***" if len(host) > 3 else "***"
    return f"{parsed.scheme or 'tcp'}://{masked_host}{(':' + str(parsed.port)) if parsed.port else ''}"


@app.get("/api/data-connections")
def get_connections():
    with session_scope() as session:
        items = session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED")).all()
        return ok([connection_to_dict(item) for item in items])


@app.post("/api/data-connections/test")
def test_connection(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        name = str(payload.get("name") or "").strip()
        source_kind = payload.get("sourceKind")
        business_type = payload.get("businessType")
        connector_type = str(payload.get("connectorType") or "").strip()
        endpoint = str(payload.get("endpoint") or payload.get("host") or "").strip()
        if not name or source_kind not in {"database", "platform"} or business_type not in {"insurance", "medical", "payment", "registry", "other"} or not connector_type or not endpoint:
            raise ApiError(422, "CONNECTION_INVALID", "请完整填写接入名称、类型和地址")
        fingerprint = stable_hash({"sourceKind": source_kind, "name": name, "businessType": business_type, "connectorType": connector_type, "endpoint": endpoint.lower()}, 40)
        duplicate = session.scalar(select(DataConnection).where(DataConnection.fingerprint == fingerprint, DataConnection.status == "CONNECTED"))
        if duplicate:
            raise ApiError(409, "DUPLICATE_CONNECTION", "该数据源已经接入")
        if session.scalar(select(func.count()).select_from(DataConnection).where(DataConnection.status == "CONNECTED")) >= 5:
            raise ApiError(409, "CONNECTION_LIMIT", "最多只能接入5个外部数据源")
        token = secrets.token_urlsafe(28)
        categories = connection_templates(business_type)
        TEST_TOKENS[token] = {
            "expires": time.time() + 300,
            "fingerprint": fingerprint,
            "public": {"sourceKind": source_kind, "name": name, "businessType": business_type, "connectorType": connector_type, "endpointMasked": mask_endpoint(endpoint), "matchKey": payload.get("matchKey") or "pet_id", "categories": categories},
        }
        return ok({"testToken": token, "expiresIn": 300, "categories": categories, "recordCount": sum(item["recordCount"] for item in categories), "dataVersion": f"EXT-{stable_hash(fingerprint, 8).upper()}", "syncedAt": iso(utcnow()), "matchMethod": "脱敏宠物编号 + 保单登记信息组合匹配"})


@app.post("/api/data-connections")
def create_connection(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        token = TEST_TOKENS.pop(str(payload.get("testToken") or ""), None)
        if not token or token["expires"] < time.time():
            raise ApiError(409, "CONNECTION_TEST_EXPIRED", "连接测试已失效，请重新测试")
        public = token["public"]
        fingerprint = token["fingerprint"]
        item_id = f"ext-{stable_hash(fingerprint, 12)}"
        if session.get(DataConnection, item_id):
            raise ApiError(409, "DUPLICATE_CONNECTION", "该数据源已经接入")
        item = DataConnection(
            id=item_id, source_kind=public["sourceKind"], name=public["name"], business_type=public["businessType"], connector_type=public["connectorType"], endpoint_masked=public["endpointMasked"],
            match_key=public["matchKey"], match_method="脱敏宠物编号 + 保单登记信息组合匹配", confidence_bps=8200, categories=public["categories"],
            data_version=f"EXT-{stable_hash(fingerprint, 8).upper()}", fingerprint=fingerprint, status="CONNECTED",
        )
        session.add(item)
        for category in public["categories"]:
            for idx in range(min(3, category["recordCount"])):
                session.add(PlatformRecord(id=f"{item_id}-r-{stable_hash(category['name'] + str(idx), 10)}", connection_id=item_id, category=category["name"], event_time=f"2026-0{3 + idx}-1{idx}", summary=f"{category['name']}记录 {idx + 1}", local_id_masked=f"EXT-****{idx + 101}", payload={"demo": True}))
        invalidate(session, exp, "connections")
        exp.connection_fingerprint = stable_hash(sorted([row.fingerprint for row in session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED")).all()] + [fingerprint]))
        bump_revision(exp)
        audit(session, exp, "DATA_CONNECTION_CREATED", "data_connection", item.id, {"businessType": item.business_type, "dataVersion": item.data_version})
        session.commit()
        return ok({"connection": connection_to_dict(item), "workflow": exp.workflow, "experimentRevision": exp.revision})


@app.delete("/api/data-connections/{connection_id}")
def delete_connection(connection_id: str, payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        item = session.get(DataConnection, connection_id)
        if not item or item.status != "CONNECTED":
            raise ApiError(404, "CONNECTION_NOT_FOUND", "数据源不存在")
        item.status = "DISCONNECTED"
        session.execute(delete(PlatformRecord).where(PlatformRecord.connection_id == connection_id))
        session.execute(delete(OntologyRelation).where(or_(OntologyRelation.from_entity_id.like(f"{connection_id}%"), OntologyRelation.to_entity_id.like(f"{connection_id}%"))))
        session.execute(delete(OntologyEntity).where(OntologyEntity.id.like(f"{connection_id}%")))
        invalidate(session, exp, "connections")
        active = session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED", DataConnection.id != connection_id)).all()
        exp.connection_fingerprint = stable_hash(sorted(row.fingerprint for row in active))
        bump_revision(exp)
        audit(session, exp, "DATA_CONNECTION_REMOVED", "data_connection", connection_id)
        session.commit()
        return ok({"removedId": connection_id, "workflow": exp.workflow, "experimentRevision": exp.revision})


BUILTIN_PLATFORMS = [
    ("atlantic", "大西洋保险", "insurance", ["投保信息", "保单", "当前理赔", "历史理赔"]),
    ("zhejiang", "浙江华西医院", "medical", ["就诊记录", "诊断", "检验", "处方", "费用票据", "诊疗图片"]),
    ("xiehe", "协合医院", "medical", ["历史就诊", "历史诊断", "检查与用药"]),
    ("pay", "支付吧平台", "payment", ["支付订单", "收款账户", "退款"]),
    ("registry", "萌宠档案平台", "registry", ["宠物身份", "芯片", "主人", "家系关系"]),
]


def create_entity(session: Session, entity_id: str, entity_type: str, label: str, local_id: str, parent_id: str | None, platform_type: str | None, attributes: dict) -> None:
    session.merge(OntologyEntity(id=entity_id, entity_type=entity_type, label=label, local_id_masked=local_id, parent_id=parent_id, platform_type=platform_type, attributes=attributes, status="ACTIVE"))


def create_relation(session: Session, from_id: str, to_id: str, relation_type: str, method: str, confidence: int, evidence: str, status: str = "MATCHED") -> None:
    session.merge(OntologyRelation(id=f"rel-{stable_hash(from_id + '|' + to_id, 24)}", from_entity_id=from_id, to_entity_id=to_id, relation_type=relation_type, match_method=method, confidence_bps=confidence, evidence=evidence, effective_period="2026-01-01 至今", confirmation_status=status))


@app.post("/api/ontology/build")
def build_ontology(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "imageReviewComplete", "请先完成材料与诊疗图片人工审核")
        claim = session.get(Claim, exp.active_claim_id)
        session.execute(delete(OntologyRelation))
        session.execute(delete(OntologyEntity))
        root_id = "pet-master"
        create_entity(session, root_id, "PET", f"{claim.pet_name} · ****668", "****668", None, "pet", {"breed": claim.breed, "species": claim.species})
        for platform_id, label, platform_type, categories in BUILTIN_PLATFORMS:
            pid = f"platform-{platform_id}"
            create_entity(session, pid, "PLATFORM", label, f"{platform_id.upper()}-****128", root_id, platform_type, {"recordCount": len(categories), "dataVersion": DATASET_VERSION})
            create_relation(session, root_id, pid, "关联平台", "保单宠物编号与平台档案组合匹配", 9400, "保单登记宠物、芯片及脱敏主人联系方式")
            for ci, category in enumerate(categories):
                cid = f"{pid}-cat-{ci}"
                create_entity(session, cid, "CATEGORY", category, f"CAT-****{ci+1:03d}", pid, platform_type, {"recordCount": 1})
                create_relation(session, pid, cid, "包含类别", "平台数据目录", 10000, f"{label}数据目录")
                rid = f"{cid}-record-1"
                create_entity(session, rid, "RECORD", f"{category}记录", f"REC-****{100+ci}", cid, platform_type, {"eventTime": claim.admission_date, "summary": f"{claim.pet_name}的{category}记录"})
                create_relation(session, cid, rid, "包含记录", "平台局部编号", 9300, f"{category}源记录")
        connections = session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED")).all()
        for conn in connections:
            pid = conn.id
            create_entity(session, pid, "PLATFORM", conn.name, conn.endpoint_masked, root_id, conn.business_type, {"recordCount": sum(c["recordCount"] for c in conn.categories), "dataVersion": conn.data_version})
            create_relation(session, root_id, pid, "外部数据源", conn.match_method, conn.confidence_bps, "一次性连接测试与脱敏身份匹配", "NEEDS_VERIFICATION")
            records = session.scalars(select(PlatformRecord).where(PlatformRecord.connection_id == conn.id)).all()
            for ci, category in enumerate(conn.categories):
                cid = f"{pid}-cat-{stable_hash(category['name'], 8)}"
                create_entity(session, cid, "CATEGORY", category["name"], f"CAT-****{ci+1:03d}", pid, conn.business_type, {"recordCount": category["recordCount"]})
                create_relation(session, pid, cid, "包含类别", "连接测试发现的数据目录", 9000, conn.data_version, "NEEDS_VERIFICATION")
                for record in [r for r in records if r.category == category["name"]]:
                    create_entity(session, record.id, "RECORD", record.summary, record.local_id_masked, cid, conn.business_type, {"eventTime": record.event_time, "summary": record.summary})
                    create_relation(session, cid, record.id, "包含记录", "平台局部编号", 8200, record.local_id_masked, "NEEDS_VERIFICATION")
        workflow_set(exp, idMatched=True, ontologyBuilt=True, ontologyConfirmed=False)
        invalidate(session, exp, "ontology")
        workflow_set(exp, idMatched=True, ontologyBuilt=True, ontologyConfirmed=False)
        bump_revision(exp)
        audit(session, exp, "ONTOLOGY_BUILT", "ontology", root_id, {"entities": session.scalar(select(func.count()).select_from(OntologyEntity))})
        session.commit()
        return ok({"focusNodeId": root_id, "workflow": exp.workflow, "experimentRevision": exp.revision})


def entity_dict(entity: OntologyEntity) -> dict:
    return {"id": entity.id, "type": entity.entity_type, "kind": entity.entity_type.lower(), "label": entity.label, "localId": entity.local_id_masked, "parentId": entity.parent_id, "platformType": entity.platform_type, "attributes": entity.attributes, **(entity.attributes or {})}


def relation_dict(rel: OntologyRelation) -> dict:
    return {"id": rel.id, "from": rel.from_entity_id, "to": rel.to_entity_id, "relationType": rel.relation_type, "matchMethod": rel.match_method, "confidence": rel.confidence_bps / 10000, "evidence": rel.evidence, "effectivePeriod": rel.effective_period, "status": rel.confirmation_status, "relationStatus": rel.confirmation_status}


@app.get("/api/ontology/focus/{entity_id}")
def ontology_focus(entity_id: str):
    with session_scope() as session:
        entity = session.get(OntologyEntity, entity_id)
        if not entity:
            raise ApiError(404, "ONTOLOGY_ENTITY_NOT_FOUND", "本体实体不存在")
        parent = session.get(OntologyEntity, entity.parent_id) if entity.parent_id else None
        children = session.scalars(select(OntologyEntity).where(OntologyEntity.parent_id == entity.id, OntologyEntity.status == "ACTIVE").order_by(OntologyEntity.id)).all()
        ids = [entity.id] + ([parent.id] if parent else []) + [child.id for child in children]
        relations = session.scalars(select(OntologyRelation).where(or_(OntologyRelation.from_entity_id.in_(ids), OntologyRelation.to_entity_id.in_(ids)))).all()
        breadcrumb = []
        cursor = entity
        while cursor:
            breadcrumb.insert(0, entity_dict(cursor))
            cursor = session.get(OntologyEntity, cursor.parent_id) if cursor.parent_id else None
        return ok({"focusNode": entity_dict(entity), "parentNode": entity_dict(parent) if parent else None, "childNodes": [entity_dict(item) for item in children], "propertyBubbles": [{"id": f"property-{key}", "label": str(value), "property": key, "interactive": False} for key, value in (entity.attributes or {}).items()][:4], "breadcrumb": breadcrumb, "relations": [relation_dict(item) for item in relations]})


@app.post("/api/ontology/confirm")
def confirm_ontology(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "ontologyBuilt", "请先匹配身份并构建本体图谱")
        session.query(OntologyRelation).update({OntologyRelation.confirmation_status: "HUMAN_CONFIRMED"})
        workflow_set(exp, ontologyConfirmed=True)
        invalidate(session, exp, "connections")
        workflow_set(exp, ontologyBuilt=True, idMatched=True, ontologyConfirmed=True)
        bump_revision(exp)
        audit(session, exp, "ONTOLOGY_CONFIRMED", "ontology", "pet-master")
        session.commit()
        return ok({"workflow": exp.workflow, "experimentRevision": exp.revision})


@app.post("/api/fact-snapshots/freeze")
def freeze_snapshot(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "ontologyConfirmed", "请先人工确认本体关系")
        claims = session.scalars(select(Claim).order_by(Claim.id)).all()
        relations = session.scalars(select(OntologyRelation).order_by(OntologyRelation.id)).all()
        connections = session.scalars(select(DataConnection).where(DataConnection.status == "CONNECTED").order_by(DataConnection.id)).all()
        reviews = session.scalars(select(ImageReview).order_by(ImageReview.id)).all()
        hash_payload = {
            "dataset": exp.dataset_version,
            "claims": [{"id": c.id, "expense": c.covered_expense_cents, "material": c.material_complete, "image": c.image_compliance} for c in claims],
            "reviews": [{"evidence": r.evidence_id, "version": r.version, "status": r.status, "tag": r.tag_code} for r in reviews],
            "connections": [{"fingerprint": c.fingerprint, "version": c.data_version, "categories": c.categories} for c in connections],
            "relations": [{"id": r.id, "status": r.confirmation_status, "confidence": r.confidence_bps} for r in relations],
        }
        content_hash = stable_hash(hash_payload, 64)
        snapshot_id = f"FS-PET-{content_hash[:12].upper()}"
        snapshot = session.get(FactSnapshot, snapshot_id)
        if not snapshot:
            snapshot = FactSnapshot(id=snapshot_id, experiment_id=exp.id, content_hash=content_hash, payload={"claimCount": len(claims), "relationCount": len(relations), "connectionCount": len(connections), "hashPayload": hash_payload}, versions={"data": exp.dataset_version, "ocr": "PET-OCR-1.0.0", "imageReview": "HUMAN-REVIEW-1.0", "ontology": "PET-ONTOLOGY-1.0.0"})
            session.add(snapshot)
        exp.active_snapshot_id = snapshot_id
        workflow_set(exp, snapshotFrozen=True, candidateSaved=False, validationPassed=False, simulated=False)
        bump_revision(exp)
        audit(session, exp, "FACT_SNAPSHOT_FROZEN", "fact_snapshot", snapshot_id, {"hash": content_hash})
        session.commit()
        return ok({"snapshot": serialize_snapshot(snapshot), "workflow": exp.workflow, "experimentRevision": exp.revision})


@app.get("/api/fact-snapshots/{snapshot_id}")
def get_snapshot(snapshot_id: str):
    with session_scope() as session:
        item = session.get(FactSnapshot, snapshot_id)
        if not item:
            raise ApiError(404, "SNAPSHOT_NOT_FOUND", "事实快照不存在")
        return ok(serialize_snapshot(item))


MODEL_SETTINGS = {
    "baseUrl": os.getenv("MODEL_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
    "model": os.getenv("MODEL_NAME", "gpt-4.1-mini"),
    "apiKey": os.getenv("MODEL_API_KEY", ""),
    "timeoutMs": int(os.getenv("MODEL_TIMEOUT_MS", "30000")),
    "updatedAt": None,
    "lastTest": None,
}


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.username or parsed.password:
        raise ApiError(422, "MODEL_URL_INVALID", "模型地址不能包含用户名或密码")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}):
        raise ApiError(422, "MODEL_URL_INVALID", "模型地址必须使用HTTPS；本机地址可使用HTTP")
    return value.rstrip("/")


def public_model_settings() -> dict:
    key = MODEL_SETTINGS.get("apiKey") or ""
    return {"baseUrl": MODEL_SETTINGS["baseUrl"], "model": MODEL_SETTINGS["model"], "timeoutMs": MODEL_SETTINGS["timeoutMs"], "configured": bool(key), "maskedKey": f"{key[:3]}***{key[-3:]}" if len(key) >= 8 else ("已配置" if key else ""), "keyMasked": f"{key[:3]}***{key[-3:]}" if len(key) >= 8 else ("已配置" if key else ""), "source": "ENVIRONMENT" if os.getenv("MODEL_API_KEY") else "MEMORY", "updatedAt": MODEL_SETTINGS["updatedAt"], "lastTest": MODEL_SETTINGS["lastTest"]}


@app.get("/api/model/settings")
def get_model_settings():
    settings = public_model_settings()
    return {"ok": True, "data": settings, "settings": settings}


@app.put("/api/model/settings")
def put_model_settings(payload: dict):
    base_url = validate_base_url(str(payload.get("baseUrl") or ""))
    model = str(payload.get("model") or "").strip()
    timeout_ms = int(payload.get("timeoutMs") or 30000)
    if not model or timeout_ms < 1000 or timeout_ms > 120000:
        raise ApiError(422, "MODEL_SETTINGS_INVALID", "请填写模型名称，超时范围为1至120秒")
    MODEL_SETTINGS.update({"baseUrl": base_url, "model": model, "timeoutMs": timeout_ms, "updatedAt": iso(utcnow())})
    if payload.get("apiKey"):
        MODEL_SETTINGS["apiKey"] = str(payload["apiKey"])
    settings = public_model_settings()
    return {"ok": True, "data": settings, "settings": settings}


@app.delete("/api/model/settings")
def delete_model_settings():
    MODEL_SETTINGS.update({"apiKey": os.getenv("MODEL_API_KEY", ""), "lastTest": None, "updatedAt": iso(utcnow())})
    settings = public_model_settings()
    return {"ok": True, "data": settings, "settings": settings}


async def model_chat(messages: list[dict]) -> tuple[dict, int]:
    if not MODEL_SETTINGS.get("apiKey"):
        raise ApiError(409, "MODEL_NOT_CONFIGURED", "请先在设置页配置模型服务")
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=MODEL_SETTINGS["timeoutMs"] / 1000) as client:
            response = await client.post(f"{MODEL_SETTINGS['baseUrl']}/chat/completions", headers={"Authorization": f"Bearer {MODEL_SETTINGS['apiKey']}", "Content-Type": "application/json"}, json={"model": MODEL_SETTINGS["model"], "temperature": 0, "response_format": {"type": "json_object"}, "messages": messages})
    except httpx.TimeoutException as exc:
        raise ApiError(504, "MODEL_TIMEOUT", "模型响应超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise ApiError(502, "MODEL_UNAVAILABLE", "无法连接模型服务") from exc
    if response.status_code == 401:
        raise ApiError(401, "MODEL_UNAUTHORIZED", "API Key无效或无权访问该模型")
    if response.status_code == 429:
        raise ApiError(429, "MODEL_RATE_LIMIT", "模型请求过于频繁，请稍后重试")
    if not response.is_success:
        raise ApiError(502, "MODEL_ERROR", f"模型服务返回异常状态 {response.status_code}")
    try:
        content = response.json()["choices"][0]["message"]["content"]
        import json
        parsed = json.loads(content)
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise ApiError(502, "MODEL_JSON_INVALID", "模型没有返回可用的结构化规则") from exc
    return parsed, int((time.perf_counter() - started) * 1000)


@app.post("/api/model/test")
async def test_model(payload: dict | None = None):
    payload = payload or {}
    if payload:
        MODEL_SETTINGS.update({"baseUrl": validate_base_url(str(payload.get("baseUrl") or MODEL_SETTINGS["baseUrl"])), "model": str(payload.get("model") or MODEL_SETTINGS["model"]), "timeoutMs": int(payload.get("timeoutMs") or MODEL_SETTINGS["timeoutMs"])})
        if payload.get("apiKey"):
            MODEL_SETTINGS["apiKey"] = str(payload["apiKey"])
    _, elapsed = await model_chat([{"role": "user", "content": "只返回JSON：{\"ok\":true}"}])
    MODEL_SETTINGS["lastTest"] = {"model": MODEL_SETTINGS["model"], "testedAt": iso(utcnow()), "latencyMs": elapsed}
    return {"ok": True, "data": MODEL_SETTINGS["lastTest"], **MODEL_SETTINGS["lastTest"]}


@app.post("/api/rules/parse-local")
def parse_rule_local(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "snapshotFrozen", "请先冻结FactSnapshot")
        rule, issues = parse_local_rule(str(payload.get("text") or payload.get("sourceText") or ""))
        snapshot = session.get(FactSnapshot, exp.active_snapshot_id)
        rule["factSnapshotHash"] = snapshot.content_hash
        return ok({"requestId": f"local-{secrets.token_hex(8)}", "rule": rule, "issues": issues, "parserVersion": PARSER_VERSION, "parseSource": "LOCAL_FALLBACK"})


@app.post("/api/rules/parse")
async def parse_rule_model(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "snapshotFrozen", "请先冻结FactSnapshot")
        snapshot = session.get(FactSnapshot, exp.active_snapshot_id)
        source_text = str(payload.get("text") or payload.get("sourceText") or "").strip()
        if not source_text:
            raise ApiError(422, "RULE_TEXT_REQUIRED", "请先输入规则描述")
    prompt = """你是宠物险策略编译器。只输出JSON对象。字段白名单：covered_expense,deductible,reimbursement_rate,remaining_limit,material_complete,image_compliance。仅支持一层AND或OR。动作保障建议仅COVERED_RECOMMENDATION、NOT_COVERED_RECOMMENDATION、INHERIT_BASELINE；路由仅AUTO_REVIEW、MANUAL_REVIEW、REQUEST_MORE、INHERIT_BASELINE。禁止REJECT或最终拒赔。结构必须包含scope(region,diseaseCode)、logic、conditions(id,field,operator,value,valueType,unit)、thenActions(coverageRecommendation,processingRoute)、elseActions、onMissing(NO_MATCH或REQUEST_MORE)、summary。"""
    parsed, elapsed = await model_chat([{"role": "system", "content": prompt}, {"role": "user", "content": source_text}])
    candidate = default_candidate_rule()
    for key in ["scope", "logic", "conditions", "thenActions", "elseActions", "onMissing"]:
        if key in parsed:
            candidate[key] = parsed[key]
    candidate.update({"sourceText": source_text, "parseSource": "MODEL", "parserVersion": "MODEL-STRUCTURED-1.0", "factSnapshotHash": snapshot.content_hash})
    issues = validate_rule(candidate)
    if any(issue["level"] == "BLOCKING" for issue in issues):
        raise ApiError(422, "MODEL_RULE_INVALID", "模型解析结果包含不支持或越权内容", {"issues": issues})
    request_id = f"model-{secrets.token_hex(10)}"
    return ok({"requestId": request_id, "rule": candidate, "issues": issues, "summary": parsed.get("summary", "规则已完成结构化解析"), "modelName": MODEL_SETTINGS["model"], "latencyMs": elapsed, "parserVersion": "MODEL-STRUCTURED-1.0", "parseSource": "MODEL"})


@app.post("/api/strategies")
def create_strategy(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "snapshotFrozen", "请先冻结FactSnapshot")
        snapshot = session.get(FactSnapshot, exp.active_snapshot_id)
        rule = dict(payload.get("rule") or {})
        rule["factSnapshotHash"] = snapshot.content_hash
        issues = validate_rule(rule)
        if issues:
            raise ApiError(422, "RULE_VALIDATION_FAILED", "候选规则仍有待处理问题", {"issues": issues})
        rule_hash = stable_hash({key: rule.get(key) for key in ["scope", "logic", "conditions", "thenActions", "elseActions", "onMissing", "factSnapshotHash"]}, 40)
        strategy_id = f"STR-{rule_hash[:16].upper()}"
        previous = session.get(Strategy, exp.active_strategy_id) if exp.active_strategy_id else None
        if previous and previous.id != strategy_id:
            previous.status = "STALE"
        item = session.get(Strategy, strategy_id)
        if not item:
            item = Strategy(
                id=strategy_id, experiment_id=exp.id, snapshot_id=snapshot.id, version=str(rule.get("version") or "1.1"), source_text=str(payload.get("sourceText") or rule.get("sourceText") or ""),
                model_output=payload.get("modelOutput") or {}, rule=rule, human_amendments=payload.get("humanAmendments") or [], parse_source=str(payload.get("parseSource") or rule.get("parseSource") or "LOCAL_FALLBACK"),
                parser_version=str(payload.get("parserVersion") or rule.get("parserVersion") or PARSER_VERSION), model_name=str(payload.get("modelName") or ""), model_request_id=str(payload.get("modelRequestId") or ""), actor=str(payload.get("actor") or "演示用户"), rule_hash=rule_hash,
            )
            session.add(item)
        checks = [{"name": "规则结构", "level": "pass", "detail": "范围、条件、THEN/ELSE与空值策略完整"}, {"name": "动作权限", "level": "pass", "detail": "未包含最终拒赔或证据越权动作"}, {"name": "事实绑定", "level": "pass", "detail": snapshot.id}]
        validation = StrategyValidation(strategy_id=strategy_id, checks=checks, passed=True, confirmed=False)
        session.add(validation)
        exp.active_strategy_id = strategy_id
        invalidate(session, exp, "strategy")
        workflow_set(exp, candidateSaved=True, validationPassed=False, simulated=False)
        bump_revision(exp)
        audit(session, exp, "STRATEGY_CONFIRMED", "strategy", strategy_id, {"parseSource": item.parse_source, "ruleHash": rule_hash}, previous.rule if previous else None, rule)
        session.commit()
        return ok({"strategy": serialize_strategy(item), "validation": serialize_validation(validation), "workflow": exp.workflow, "experimentRevision": exp.revision})


@app.get("/api/strategies/{strategy_id}/validation")
def get_strategy_validation(strategy_id: str):
    with session_scope() as session:
        strategy = session.get(Strategy, strategy_id)
        if not strategy:
            raise ApiError(404, "STRATEGY_NOT_FOUND", "候选策略不存在")
        item = session.scalars(select(StrategyValidation).where(StrategyValidation.strategy_id == strategy_id).order_by(StrategyValidation.id.desc())).first()
        return ok(serialize_validation(item))


@app.post("/api/strategies/{strategy_id}/validation-confirmations")
def confirm_validation(strategy_id: str, payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "candidateSaved", "请先保存候选策略")
        if exp.active_strategy_id != strategy_id:
            raise ApiError(409, "STALE_STRATEGY", "该策略已不是当前候选版本")
        item = session.scalars(select(StrategyValidation).where(StrategyValidation.strategy_id == strategy_id).order_by(StrategyValidation.id.desc())).first()
        if not item or not item.passed:
            raise ApiError(409, "VALIDATION_BLOCKED", "规则检查仍有阻断项")
        item.confirmed = True
        item.confirmed_at = utcnow()
        workflow_set(exp, validationPassed=True, simulated=False)
        bump_revision(exp)
        audit(session, exp, "STRATEGY_VALIDATION_CONFIRMED", "strategy", strategy_id)
        session.commit()
        return ok({"validation": serialize_validation(item), "workflow": exp.workflow, "experimentRevision": exp.revision})


@app.post("/api/simulations")
def create_simulation(payload: dict):
    with session_scope() as session:
        exp = experiment(session)
        require_revision(exp, payload)
        require_flow(exp, "validationPassed", "请先确认规则检查结果")
        strategy = session.get(Strategy, exp.active_strategy_id)
        snapshot = session.get(FactSnapshot, exp.active_snapshot_id)
        if not strategy or strategy.status != "CONFIRMED" or not snapshot or snapshot.status != "FROZEN":
            raise ApiError(409, "STALE_INPUT", "仿真输入已经失效，请重新冻结快照并确认规则")
        run_id = f"SIM-{stable_hash(snapshot.content_hash + strategy.rule_hash, 20).upper()}"
        run = session.get(SimulationRun, run_id)
        if not run:
            claims = session.scalars(select(Claim).order_by(Claim.id)).all()
            metrics, cases, distribution = simulate_claims(claims, strategy.rule)
            run = SimulationRun(id=run_id, experiment_id=exp.id, snapshot_id=snapshot.id, strategy_id=strategy.id, rule_hash=strategy.rule_hash, metrics=metrics, distribution=distribution)
            session.add(run)
            session.flush()
            for case in cases:
                session.add(SimulationCase(run_id=run_id, claim_id=case["claim"].id, changed=case["changed"], old_decision=case["old"], new_decision=case["new"], payout_delta_cents=case["payoutDeltaCents"]))
        exp.active_run_id = run_id
        workflow_set(exp, simulated=True)
        bump_revision(exp)
        audit(session, exp, "SIMULATION_COMPLETED", "simulation_run", run_id, {"strategyId": strategy.id, "snapshotId": snapshot.id})
        session.commit()
        return ok({"run": serialize_run(session, run, include_cases=True), "workflow": exp.workflow, "experimentRevision": exp.revision})


@app.get("/api/simulations/{run_id}")
def get_simulation(run_id: str):
    with session_scope() as session:
        run = session.get(SimulationRun, run_id)
        if not run:
            raise ApiError(404, "SIMULATION_NOT_FOUND", "仿真运行不存在")
        return ok(serialize_run(session, run, include_cases=False))


@app.get("/api/simulations/{run_id}/cases")
def get_simulation_cases(run_id: str, changed: bool | None = None, migration: str = "", limit: int = 320, offset: int = 0):
    with session_scope() as session:
        if not session.get(SimulationRun, run_id):
            raise ApiError(404, "SIMULATION_NOT_FOUND", "仿真运行不存在")
        stmt = select(SimulationCase, Claim).join(Claim, Claim.id == SimulationCase.claim_id).where(SimulationCase.run_id == run_id)
        if changed is not None:
            stmt = stmt.where(SimulationCase.changed == changed)
        rows = session.execute(stmt.order_by(SimulationCase.id).offset(max(0, offset)).limit(min(320, max(1, limit)))).all()
        items = [simulation_case_dict(case, claim) for case, claim in rows]
        if migration:
            parts = migration.split("_TO_")
            if len(parts) == 2:
                items = [item for item in items if item["oldDecision"]["coverageRecommendation"].startswith(parts[0]) and item["newDecision"]["coverageRecommendation"].startswith(parts[1])]
        return ok({"items": items, "total": len(items)})


@app.get("/api/simulations/{run_id}/report")
def simulation_report(run_id: str):
    with session_scope() as session:
        run = session.get(SimulationRun, run_id)
        if not run:
            raise ApiError(404, "SIMULATION_NOT_FOUND", "仿真运行不存在")
        metrics = run.metrics
        report = f"Strategy Sandbox 宠物险仿真报告\n运行：{run.id}\n快照：{run.snapshot_id}\n策略：{run.strategy_id}\n受影响案件：{metrics['affectedCases']}\n覆盖建议增量：{metrics['coverageRecommendationDelta']}\n核定赔付变化：{metrics['payableDelta']} 元\n人工工时变化：{metrics['workHoursDelta']} 小时\n"
        return PlainTextResponse(report, headers={"Content-Disposition": f'attachment; filename="{run.id}.txt"'})


@app.get("/api/audit-events")
def audit_events(limit: int = 200, offset: int = 0):
    with session_scope() as session:
        rows = session.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).offset(max(0, offset)).limit(min(500, max(1, limit)))).all()
        return ok({"items": [{"id": item.id, "eventType": item.event_type, "entityType": item.entity_type, "entityId": item.entity_id, "actor": item.actor, "revision": item.revision, "beforeHash": item.before_hash, "afterHash": item.after_hash, "details": item.details, "createdAt": iso(item.created_at)} for item in rows], "total": len(rows)})


app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/{path:path}")
def static_file(path: str):
    candidate = (ROOT / path).resolve()
    if candidate.parent == ROOT.resolve() and candidate.is_file() and candidate.suffix in {".js", ".css", ".html", ".ico", ".svg", ".png", ".webp"}:
        return FileResponse(candidate)
    return FileResponse(ROOT / "index.html")

