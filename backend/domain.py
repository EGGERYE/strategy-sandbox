from __future__ import annotations

import hashlib
import json
import random
import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .database import (
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
    SimulationCase,
    SimulationRun,
    Strategy,
    StrategyValidation,
    utcnow,
)


EXPERIMENT_ID = "pet-gi-demo"
SEED = 20260814
DATASET_VERSION = "FS-PET-GI-SH-2026Q2-01"
PARSER_VERSION = "PET-RULE-PARSER-PY-2.0"
BASELINE_VERSION = "PET-GI-BASELINE-1.0"
DEFAULT_WORKFLOW = {
    "datasetSelected": True,
    "materialsRegistered": False,
    "ocrValidated": False,
    "imageReviewComplete": False,
    "idMatched": False,
    "ontologyBuilt": False,
    "ontologyConfirmed": False,
    "snapshotFrozen": False,
    "candidateSaved": False,
    "validationPassed": False,
    "simulated": False,
}

FIELDS = {
    "covered_expense": {"type": "number", "unit": "CNY", "aliases": ["可覆盖费用", "覆盖费用", "可赔费用"]},
    "deductible": {"type": "number", "unit": "CNY", "aliases": ["免赔额"]},
    "reimbursement_rate": {"type": "number", "unit": "PERCENT", "aliases": ["赔付比例", "报销比例"]},
    "remaining_limit": {"type": "number", "unit": "CNY", "aliases": ["剩余额度", "剩余保额"]},
    "material_complete": {"type": "boolean", "unit": "BOOLEAN", "aliases": ["材料完整", "资料完整"]},
    "image_compliance": {"type": "enum", "unit": "STATUS", "aliases": ["图片审核", "诊疗图片", "图片合规"]},
}
OPS = {">", ">=", "<", "<=", "=", "!=", "IN", "NOT_IN"}
COVERAGE_ACTIONS = {"COVERED_RECOMMENDATION", "NOT_COVERED_RECOMMENDATION", "INHERIT_BASELINE"}
ROUTE_ACTIONS = {"AUTO_REVIEW", "MANUAL_REVIEW", "REQUEST_MORE", "INHERIT_BASELINE"}


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def stable_hash(value: Any, length: int = 32) -> str:
    raw = value if isinstance(value, str) else canonical(value)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:length]


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def yuan(cents: int) -> float:
    return float((Decimal(cents) / Decimal(100)).quantize(Decimal("0.01")))


def cents(value: Any) -> int:
    return int((Decimal(str(value)) * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def default_candidate_rule(threshold: float = 500) -> dict:
    return {
        "id": "PET-GI-CANDIDATE-1.1",
        "version": "1.1",
        "sourceText": f"上海地区急性肠胃炎案件，当可覆盖费用超过{threshold:g}元时给出不覆盖建议，否则给出覆盖建议；字段缺失时请求补件。",
        "parserVersion": PARSER_VERSION,
        "scope": {"region": "上海", "diseaseCode": "GASTROENTERITIS"},
        "logic": "AND",
        "conditions": [{"id": "condition-1", "field": "covered_expense", "operator": ">", "value": threshold, "valueType": "number", "unit": "CNY"}],
        "thenActions": {"coverageRecommendation": "NOT_COVERED_RECOMMENDATION", "processingRoute": "INHERIT_BASELINE"},
        "elseActions": {"coverageRecommendation": "COVERED_RECOMMENDATION", "processingRoute": "INHERIT_BASELINE"},
        "onMissing": "REQUEST_MORE",
        "parseSource": "LOCAL_FALLBACK",
        "factSnapshotHash": "",
    }


def seed_database(session: Session) -> None:
    rng = random.Random(SEED)
    exp = Experiment(
        id=EXPERIMENT_ID,
        name="上海宠物险肠胃炎阈值实验",
        dataset_version=DATASET_VERSION,
        seed=SEED,
        revision=1,
        workflow=dict(DEFAULT_WORKFLOW),
        active_claim_id="CLM-SH-20260001",
    )
    session.add(exp)
    boundary = [19900, 20000, 20001, 49999, 50000, 50001]
    pet_names = ["团子", "麦子", "可乐", "糯米", "布丁", "雪球", "豆包", "年糕", "奶盖", "旺财"]
    hospitals = ["浙江华西医院", "协合医院", "伴伴宠物医院", "爱宠动物医院"]
    for idx in range(320):
        n = idx + 1
        fixed = idx < len(boundary)
        covered = boundary[idx] if fixed else rng.randint(12000, 82000)
        region = "上海" if fixed or rng.random() < 0.72 else rng.choice(["杭州", "苏州", "南京"])
        disease_code = "GASTROENTERITIS" if fixed or rng.random() < 0.67 else rng.choice(["DERMATITIS", "RESPIRATORY", "FRACTURE"])
        disease = {"GASTROENTERITIS": "急性肠胃炎", "DERMATITIS": "皮炎", "RESPIRATORY": "呼吸道感染", "FRACTURE": "骨折"}[disease_code]
        claim_id = f"CLM-{region[:2] if region != '上海' else 'SH'}-2026{n:04d}"
        claim = Claim(
            id=claim_id,
            policy_id=f"POL-PET-{n:05d}",
            pet_id=f"PET-****{660 + n % 330:03d}",
            owner_id=f"OWN-****{1000 + n:04d}",
            pet_name=pet_names[idx % len(pet_names)],
            species="猫" if idx % 3 else "犬",
            breed="英短" if idx % 3 else "柯基",
            region=region,
            hospital=hospitals[idx % len(hospitals)],
            disease_code=disease_code,
            disease=disease,
            claim_amount_cents=covered + rng.randint(1500, 10000),
            covered_expense_cents=covered,
            deductible_cents=rng.choice([0, 5000, 10000]),
            reimbursement_bps=rng.choice([7000, 8000, 9000]),
            remaining_limit_cents=rng.randint(100000, 600000),
            material_complete=None if idx in {19, 119} else rng.random() > 0.08,
            ocr_confidence_bps=rng.randint(7600, 9900),
            image_compliance=None if idx < 20 else rng.choice(["PASS", "PASS", "PASS", "NEEDS_REVIEW", "FAIL"]),
            admission_date=f"2026-{2 + idx % 5:02d}-{1 + idx % 27:02d}",
            line_items=[
                {"name": "诊察费", "coveredCents": min(covered, 8000)},
                {"name": "检验费", "coveredCents": max(0, min(covered - 8000, 18000))},
                {"name": "药品费", "coveredCents": max(0, covered - 26000)},
            ],
            risk_facts={"duplicateEvidence": idx % 41 == 0, "dateAnomaly": idx % 67 == 0, "familyCluster": idx % 53 == 0},
        )
        session.add(claim)
        evidence_specs = [
            ("medical_record", "病例", "病例扫描件.pdf", "application/pdf", 9200),
            ("invoice", "发票", "医疗发票.png", "image/png", 9600),
            ("prescription", "处方", "处方单.pdf", "application/pdf", 9000),
            ("lab_report", "检验报告", "检验报告.png", "image/png", 8800),
            ("diagnostic_image", "诊疗图片", "诊疗图片.webp", "image/webp", None),
        ]
        for evidence_type, label, file_name, mime, confidence in evidence_specs:
            evidence_id = f"EV-{n:04d}-{evidence_type}"
            session.add(EvidenceItem(
                id=evidence_id,
                claim_id=claim_id,
                evidence_type=evidence_type,
                file_name=file_name,
                mime_type=mime,
                source_hash=stable_hash(f"{SEED}:{claim_id}:{evidence_type}", 64),
                size_bytes=124000 + idx * 31,
                confidence_bps=confidence,
                recognition_result={} if evidence_type == "diagnostic_image" else {"label": label, "text": f"{disease}；可覆盖费用{yuan(covered):.2f}元"},
                structured_fact={} if evidence_type == "diagnostic_image" else {"diseaseCode": disease_code, "coveredExpense": yuan(covered)},
                status="REGISTERED",
            ))
    audit(session, exp, "DEMO_SEEDED", "experiment", exp.id, {"seed": SEED, "claims": 320})


def audit(session: Session, exp: Experiment, event_type: str, entity_type: str, entity_id: str, details: dict | None = None, before: Any = None, after: Any = None) -> None:
    session.add(AuditEvent(
        experiment_id=exp.id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        revision=exp.revision,
        before_hash=stable_hash(before) if before is not None else None,
        after_hash=stable_hash(after) if after is not None else None,
        details=details or {},
    ))


def bump_revision(exp: Experiment) -> int:
    exp.revision += 1
    exp.updated_at = utcnow()
    return exp.revision


def invalidate(session: Session, exp: Experiment, level: str) -> None:
    flow = dict(exp.workflow or DEFAULT_WORKFLOW)
    order = {
        "materials": ["idMatched", "ontologyBuilt", "ontologyConfirmed", "snapshotFrozen", "candidateSaved", "validationPassed", "simulated"],
        "ontology": ["ontologyConfirmed", "snapshotFrozen", "candidateSaved", "validationPassed", "simulated"],
        "connections": ["ontologyConfirmed", "snapshotFrozen", "candidateSaved", "validationPassed", "simulated"],
        "strategy": ["validationPassed", "simulated"],
    }
    for key in order.get(level, []):
        flow[key] = False
    exp.workflow = flow
    if level in {"materials", "ontology", "connections"}:
        if exp.active_snapshot_id:
            session.execute(update(FactSnapshot).where(FactSnapshot.id == exp.active_snapshot_id).values(status="STALE"))
        if exp.active_strategy_id:
            session.execute(update(Strategy).where(Strategy.id == exp.active_strategy_id).values(status="STALE"))
        exp.active_snapshot_id = None
        exp.active_strategy_id = None
    if level in {"materials", "ontology", "connections", "strategy"}:
        exp.active_run_id = None


def claim_to_dict(claim: Claim, include_evidence: bool = False) -> dict:
    result = {
        "id": claim.id,
        "policyId": claim.policy_id,
        "petId": claim.pet_id,
        "ownerId": claim.owner_id,
        "petName": claim.pet_name,
        "species": claim.species,
        "breed": claim.breed,
        "region": claim.region,
        "hospital": claim.hospital,
        "diseaseCode": claim.disease_code,
        "disease": claim.disease,
        "claimAmount": yuan(claim.claim_amount_cents),
        "coveredExpense": yuan(claim.covered_expense_cents),
        "deductible": yuan(claim.deductible_cents),
        "reimbursementRate": claim.reimbursement_bps / 10000,
        "remainingLimit": yuan(claim.remaining_limit_cents),
        "materialComplete": claim.material_complete,
        "ocrConfidence": claim.ocr_confidence_bps / 10000,
        "imageCompliance": claim.image_compliance,
        "admissionDate": claim.admission_date,
        "lineItems": [{"name": item.get("name", "费用项目"), "amount": yuan(int(item.get("coveredCents", 0))), "eligible": True} for item in claim.line_items],
        "riskFacts": claim.risk_facts,
    }
    if include_evidence:
        result["evidence"] = [evidence_to_dict(item) for item in claim.evidence_items]
    return result


def evidence_to_dict(item: EvidenceItem) -> dict:
    return {
        "id": item.id,
        "claimId": item.claim_id,
        "type": item.evidence_type,
        "fileName": item.file_name,
        "mimeType": item.mime_type,
        "sourceHash": item.source_hash,
        "sizeBytes": item.size_bytes,
        "confidence": None if item.confidence_bps is None else item.confidence_bps / 10000,
        "recognitionResult": item.recognition_result,
        "structuredFact": item.structured_fact,
        "status": item.status,
        "createdAt": iso(item.created_at),
    }


def review_to_dict(review: ImageReview) -> dict:
    return {
        "id": review.id,
        "evidenceId": review.evidence_id,
        "status": review.status,
        "tagCode": review.tag_code,
        "tagLabel": review.tag_label,
        "comment": review.comment,
        "reviewer": review.reviewer,
        "version": review.version,
        "sourceHash": review.source_hash,
        "createdAt": iso(review.created_at),
    }


def connection_to_dict(item: DataConnection) -> dict:
    return {
        "id": item.id,
        "sourceKind": item.source_kind,
        "name": item.name,
        "businessType": item.business_type,
        "connectorType": item.connector_type,
        "endpointMasked": item.endpoint_masked,
        "matchKey": item.match_key,
        "matchMethod": item.match_method,
        "confidence": item.confidence_bps / 10000,
        "categories": item.categories,
        "dataVersion": item.data_version,
        "syncedAt": iso(item.synced_at),
        "fingerprint": item.fingerprint,
        "status": item.status,
        "relationStatus": "NEEDS_VERIFICATION",
    }


def parse_local_rule(text: str) -> tuple[dict, list[dict]]:
    source = (text or "").strip()
    rule = default_candidate_rule()
    rule["sourceText"] = source
    rule["parseSource"] = "LOCAL_FALLBACK"
    issues: list[dict] = []
    if not source:
        return rule, [{"code": "SOURCE_REQUIRED", "level": "BLOCKING", "target": "sourceText", "message": "请先输入规则描述", "suggestedFix": "用一句话说明适用范围、条件和处理结果"}]
    regions = [name for name in ["上海", "杭州", "苏州", "南京"] if name in source]
    diseases = [("GASTROENTERITIS", "肠胃炎"), ("DERMATITIS", "皮炎"), ("RESPIRATORY", "呼吸道")]
    disease_hits = [code for code, label in diseases if label in source]
    rule["scope"] = {"region": regions[0] if len(regions) == 1 else "", "diseaseCode": disease_hits[0] if len(disease_hits) == 1 else ""}
    if len(regions) != 1:
        issues.append({"code": "SCOPE_REGION", "level": "BLOCKING", "target": "scope.region", "message": "请明确一个适用地区", "suggestedFix": "例如：上海地区"})
    if len(disease_hits) != 1:
        issues.append({"code": "SCOPE_DISEASE", "level": "BLOCKING", "target": "scope.diseaseCode", "message": "请明确一个适用疾病", "suggestedFix": "例如：急性肠胃炎"})
    normalized = source.replace("大于或等于", "不少于").replace("小于或等于", "不超过")
    rule["logic"] = "OR" if re.search(r"(?:或者|或是|\sOR\s|\s或\s)", normalized, re.I) else "AND"
    if re.search(r"(?:并且|且|\sAND\s)", normalized, re.I) and rule["logic"] == "OR":
        issues.append({"code": "MIXED_LOGIC", "level": "BLOCKING", "target": "logic", "message": "首版不能混合使用“并且”和“或者”", "suggestedFix": "统一选择全部满足或任意满足"})
    condition_clauses = re.split(r"(?:并且|且|或者|或是|\sAND\s|\sOR\s|；|;)", normalized, flags=re.I)
    conditions: list[dict] = []
    operator_patterns = [(r"不少于|不低于|至少", ">="), (r"不超过|不高于|至多", "<="), (r"超过|大于|高于", ">"), (r"低于|小于|少于", "<"), (r"不等于", "!="), (r"等于|为", "=")]
    for clause in condition_clauses:
        found_field = next(((field, meta) for field, meta in FIELDS.items() if any(alias in clause for alias in meta["aliases"])), None)
        if not found_field:
            continue
        field, meta = found_field
        op = next((symbol for pattern, symbol in operator_patterns if re.search(pattern, clause)), None)
        value_match = re.search(r"(-?\d+(?:\.\d+)?)\s*(元|%|％)?", clause)
        if meta["type"] == "number" and op and value_match:
            value = float(value_match.group(1))
            unit = "PERCENT" if value_match.group(2) in {"%", "％"} else "CNY"
            conditions.append({"id": f"condition-{len(conditions)+1}", "field": field, "operator": op, "value": value, "valueType": "number", "unit": unit})
        elif field == "material_complete":
            conditions.append({"id": f"condition-{len(conditions)+1}", "field": field, "operator": "=", "value": not any(x in clause for x in ["不完整", "缺失", "缺少"]), "valueType": "boolean", "unit": "BOOLEAN"})
        elif field == "image_compliance":
            values = [key for key, label in [("PASS", "通过"), ("FAIL", "不通过"), ("NEEDS_REVIEW", "待复核")] if label in clause]
            conditions.append({"id": f"condition-{len(conditions)+1}", "field": field, "operator": "IN" if len(values) > 1 else "=", "value": values if len(values) > 1 else (values[0] if values else "PASS"), "valueType": "enum", "unit": "STATUS"})
    if conditions:
        rule["conditions"] = conditions
    else:
        issues.append({"code": "CONDITION_REQUIRED", "level": "BLOCKING", "target": "conditions", "message": "没有识别到可执行判断条件", "suggestedFix": "例如：可覆盖费用超过500元"})
    lower = source.lower()
    if "拒赔" in source or "自动拒绝" in source:
        issues.append({"code": "FORBIDDEN_REJECT", "level": "BLOCKING", "target": "actions", "message": "规则不能直接产生最终拒赔", "suggestedFix": "改为人工复核或不覆盖建议"})
    rule["thenActions"] = {
        "coverageRecommendation": "NOT_COVERED_RECOMMENDATION" if "不覆盖" in source else "INHERIT_BASELINE",
        "processingRoute": "MANUAL_REVIEW" if "人工" in source else ("REQUEST_MORE" if "补件" in source and "缺失" not in source else "INHERIT_BASELINE"),
    }
    rule["elseActions"] = {
        "coverageRecommendation": "COVERED_RECOMMENDATION" if re.search(r"否则.*覆盖", source) else "INHERIT_BASELINE",
        "processingRoute": "AUTO_REVIEW" if re.search(r"否则.*自动审核", source) else "INHERIT_BASELINE",
    }
    rule["onMissing"] = "REQUEST_MORE" if any(x in source for x in ["缺失", "缺少", "补件"]) else ""
    if not rule["onMissing"]:
        issues.append({"code": "MISSING_POLICY", "level": "BLOCKING", "target": "onMissing", "message": "请说明数据缺失时怎么处理", "suggestedFix": "选择按未命中处理或请求补件"})
    issues.extend(validate_rule(rule, include_snapshot=False))
    unique = {(i["code"], i["target"]): i for i in issues}
    return rule, list(unique.values())


def validate_rule(rule: dict, include_snapshot: bool = True) -> list[dict]:
    issues: list[dict] = []
    scope = rule.get("scope") or {}
    if scope.get("region") not in {"上海", "杭州", "苏州", "南京", "ALL"}:
        issues.append(_issue("SCOPE_REGION", "scope.region", "请选择规则适用地区"))
    if scope.get("diseaseCode") not in {"GASTROENTERITIS", "DERMATITIS", "RESPIRATORY", "FRACTURE", "ALL"}:
        issues.append(_issue("SCOPE_DISEASE", "scope.diseaseCode", "请选择规则适用疾病"))
    conditions = rule.get("conditions") or []
    if not conditions:
        issues.append(_issue("CONDITION_REQUIRED", "conditions", "至少需要一个判断条件"))
    if rule.get("logic") not in {"AND", "OR"}:
        issues.append(_issue("LOGIC", "logic", "请选择“全部满足”或“任意满足”"))
    for index, condition in enumerate(conditions):
        field = condition.get("field")
        meta = FIELDS.get(field)
        target = f"conditions.{index}"
        if not meta:
            issues.append(_issue("UNKNOWN_FIELD", target, "存在系统不支持的判断字段"))
            continue
        if condition.get("operator") not in OPS:
            issues.append(_issue("OPERATOR", target, "请选择有效的比较方式"))
        value = condition.get("value")
        if meta["type"] == "number":
            if value in {None, ""} or isinstance(value, bool):
                issues.append(_issue("VALUE", target, "请输入数字阈值"))
            else:
                try:
                    number = float(value)
                    if number < 0 or (field == "reimbursement_rate" and number > 100):
                        issues.append(_issue("VALUE_RANGE", target, "阈值超出允许范围"))
                except (TypeError, ValueError):
                    issues.append(_issue("VALUE", target, "请输入有效数字"))
            if condition.get("unit") != meta["unit"]:
                issues.append(_issue("UNIT_MISMATCH", target, "数值单位与字段不一致"))
        if condition.get("operator") in {"IN", "NOT_IN"} and not isinstance(value, list):
            issues.append(_issue("SET_VALUE", target, "集合判断需要选择多个值"))
    for branch in ["thenActions", "elseActions"]:
        actions = rule.get(branch) or {}
        if actions.get("coverageRecommendation") not in COVERAGE_ACTIONS:
            issues.append(_issue("ACTION_COVERAGE", branch, "请选择保障建议"))
        if actions.get("processingRoute") not in ROUTE_ACTIONS:
            issues.append(_issue("ACTION_ROUTE", branch, "请选择后续处理方式"))
    if rule.get("onMissing") not in {"NO_MATCH", "REQUEST_MORE"}:
        issues.append(_issue("MISSING_POLICY", "onMissing", "请选择数据缺失处理方式"))
    if any(c.get("field") in {"material_complete", "image_compliance"} for c in conditions):
        for branch in ["thenActions", "elseActions"]:
            actions = rule.get(branch) or {}
            if actions.get("coverageRecommendation") not in {"INHERIT_BASELINE"}:
                issues.append(_issue("EVIDENCE_PERMISSION", branch, "材料或图片只能改变复核/补件路由，不能改变保障建议"))
            if actions.get("processingRoute") == "AUTO_REVIEW":
                issues.append(_issue("EVIDENCE_AUTO_ROUTE", branch, "材料或图片条件不能直接进入自动审核"))
    if include_snapshot and not rule.get("factSnapshotHash"):
        issues.append(_issue("SNAPSHOT_REQUIRED", "factSnapshotHash", "规则尚未绑定冻结事实快照"))
    return issues


def _issue(code: str, target: str, message: str, level: str = "BLOCKING") -> dict:
    return {"code": code, "level": level, "target": target, "message": message, "suggestedFix": message}


def _claim_value(claim: Claim, field: str) -> Any:
    return {
        "covered_expense": yuan(claim.covered_expense_cents),
        "deductible": yuan(claim.deductible_cents),
        "reimbursement_rate": claim.reimbursement_bps / 100,
        "remaining_limit": yuan(claim.remaining_limit_cents),
        "material_complete": claim.material_complete,
        "image_compliance": claim.image_compliance,
    }.get(field)


def evaluate_condition(claim: Claim, condition: dict) -> dict:
    actual = _claim_value(claim, condition.get("field", ""))
    if actual is None:
        field = condition.get("field")
        return {"conditionId": condition.get("id"), "id": condition.get("id"), "field": field, "label": {"covered_expense": "可覆盖费用", "deductible": "免赔额", "reimbursement_rate": "赔付比例", "remaining_limit": "剩余额度", "material_complete": "材料完整度", "image_compliance": "图片审核结论"}.get(field, field), "operator": condition.get("operator"), "expected": condition.get("value"), "actual": None, "matched": False, "missing": True}
    expected = condition.get("value")
    op = condition.get("operator")
    try:
        matched = {">": actual > expected, ">=": actual >= expected, "<": actual < expected, "<=": actual <= expected, "=": actual == expected, "!=": actual != expected, "IN": actual in expected, "NOT_IN": actual not in expected}[op]
    except (KeyError, TypeError):
        matched = False
    field = condition.get("field")
    return {"conditionId": condition.get("id"), "id": condition.get("id"), "field": field, "label": {"covered_expense": "可覆盖费用", "deductible": "免赔额", "reimbursement_rate": "赔付比例", "remaining_limit": "剩余额度", "material_complete": "材料完整度", "image_compliance": "图片审核结论"}.get(field, field), "operator": op, "expected": expected, "actual": actual, "matched": bool(matched), "missing": False}


def payout_cents(claim: Claim, covered: bool) -> int:
    if not covered:
        return 0
    eligible = max(0, claim.covered_expense_cents - claim.deductible_cents)
    amount = (eligible * claim.reimbursement_bps + 5000) // 10000
    return min(claim.remaining_limit_cents, amount)


def baseline_decision(claim: Claim) -> dict:
    in_scope = claim.region == "上海" and claim.disease_code == "GASTROENTERITIS"
    not_covered = in_scope and claim.covered_expense_cents > 20000
    recommendation = "NOT_COVERED_RECOMMENDATION" if not_covered else "COVERED_RECOMMENDATION"
    if claim.material_complete is not True:
        route = "REQUEST_MORE"
    elif claim.image_compliance in {"FAIL", "NEEDS_REVIEW"}:
        route = "MANUAL_REVIEW"
    else:
        route = "AUTO_REVIEW"
    return {
        "coverageRecommendation": recommendation,
        "processingRoute": route,
        "payableCents": payout_cents(claim, not not_covered),
        "payableAmount": yuan(payout_cents(claim, not not_covered)),
        "branch": "BASELINE",
        "inScope": in_scope,
        "signals": ["BASELINE_SCOPE" if in_scope else "OUT_OF_SCOPE"],
        "ruleHit": "GI-COVERED-EXPENSE-THRESHOLD" if not_covered else ("GI-WITHIN-THRESHOLD" if in_scope else "OUT_OF_EXPERIMENT_SCOPE"),
        "conditionTrace": [],
        "explanation": "上海肠胃炎案件按可覆盖费用严格大于200元执行现行保障建议。",
    }


def candidate_decision(claim: Claim, rule: dict) -> dict:
    baseline = baseline_decision(claim)
    scope = rule.get("scope") or {}
    if scope.get("region") not in {"ALL", claim.region} or scope.get("diseaseCode") not in {"ALL", claim.disease_code}:
        return {**baseline, "branch": "OUT_OF_SCOPE", "inScope": False, "ruleHit": "CANDIDATE_OUT_OF_SCOPE", "explanation": "案件不在候选规则范围内，沿用现行策略。"}
    trace = [evaluate_condition(claim, condition) for condition in rule.get("conditions", [])]
    if any(item["missing"] for item in trace) and rule.get("onMissing") == "REQUEST_MORE":
        return {**baseline, "processingRoute": "REQUEST_MORE", "branch": "MISSING", "inScope": True, "ruleHit": "CANDIDATE_MISSING_REQUEST_MORE", "signals": [*baseline.get("signals", []), "CANDIDATE_FACT_MISSING"], "conditionTrace": trace, "explanation": "判断字段缺失，按规则请求补件。"}
    values = [False if item["missing"] else item["matched"] for item in trace]
    matched = any(values) if rule.get("logic") == "OR" else all(values)
    branch = "THEN" if matched else "ELSE"
    actions = rule.get("thenActions" if matched else "elseActions") or {}
    recommendation = actions.get("coverageRecommendation")
    route = actions.get("processingRoute")
    if recommendation == "INHERIT_BASELINE":
        recommendation = baseline["coverageRecommendation"]
    if route == "INHERIT_BASELINE":
        route = baseline["processingRoute"]
    payable = payout_cents(claim, recommendation == "COVERED_RECOMMENDATION")
    return {
        "coverageRecommendation": recommendation,
        "processingRoute": route,
        "payableCents": payable,
        "payableAmount": yuan(payable),
        "branch": branch,
        "inScope": True,
        "signals": [*baseline.get("signals", []), f"CANDIDATE_{branch}"],
        "ruleHit": f"CANDIDATE_{branch}_{stable_hash(rule, 8).upper()}",
        "conditionTrace": trace,
        "explanation": f"候选规则条件{'命中' if matched else '未命中'}，执行{branch}分支。",
    }


def simulate_claims(claims: list[Claim], rule: dict) -> tuple[dict, list[dict], list[dict]]:
    cases: list[dict] = []
    old_counts = {"covered": 0, "notCovered": 0, "auto": 0, "manual": 0, "requestMore": 0, "payableCents": 0}
    new_counts = dict(old_counts)
    distribution = [0] * 16
    for claim in claims:
        old = baseline_decision(claim)
        new = candidate_decision(claim, rule)
        for decision, target in [(old, old_counts), (new, new_counts)]:
            target["covered" if decision["coverageRecommendation"] == "COVERED_RECOMMENDATION" else "notCovered"] += 1
            target[{"AUTO_REVIEW": "auto", "MANUAL_REVIEW": "manual", "REQUEST_MORE": "requestMore"}[decision["processingRoute"]]] += 1
            target["payableCents"] += decision["payableCents"]
        bucket = min(15, max(0, claim.covered_expense_cents // 5000))
        distribution[bucket] += 1
        changed = old["coverageRecommendation"] != new["coverageRecommendation"] or old["processingRoute"] != new["processingRoute"] or old["payableCents"] != new["payableCents"]
        cases.append({"claim": claim, "old": old, "new": new, "changed": changed, "payoutDeltaCents": new["payableCents"] - old["payableCents"]})
    changed_count = sum(1 for item in cases if item["changed"])
    metrics = {
        "totalCases": len(claims),
        "affectedCases": changed_count,
        "coverageRecommendationDelta": new_counts["covered"] - old_counts["covered"],
        "payableDeltaCents": new_counts["payableCents"] - old_counts["payableCents"],
        "payableDelta": yuan(new_counts["payableCents"] - old_counts["payableCents"]),
        "workHoursDelta": round(((new_counts["manual"] - old_counts["manual"]) * 12 + (new_counts["requestMore"] - old_counts["requestMore"]) * 8) / 60, 1),
        "oldSummary": {**old_counts, "payable": yuan(old_counts["payableCents"])},
        "newSummary": {**new_counts, "payable": yuan(new_counts["payableCents"])},
        "maturity": {"affectedCases": "OBSERVED_REPLAY", "coverageRecommendationDelta": "OBSERVED_REPLAY", "payableDelta": "ESTIMATE", "workHoursDelta": "ASSUMPTION"},
    }
    dist = [{"from": index * 50, "to": (index + 1) * 50, "count": count} for index, count in enumerate(distribution)]
    return metrics, cases, dist


def reset_database(session: Session) -> None:
    for model in [SimulationCase, SimulationRun, StrategyValidation, Strategy, FactSnapshot, OntologyRelation, OntologyEntity, PlatformRecord, DataConnection, ImageReview, EvidenceItem, Claim, AuditEvent, Experiment]:
        session.execute(delete(model))
    session.flush()
    seed_database(session)

