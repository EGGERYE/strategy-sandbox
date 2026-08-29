from __future__ import annotations
import hashlib

import io

from fastapi.testclient import TestClient

from backend.main import app


def post(client: TestClient, path: str, revision: int, **extra):
    return client.post(path, json={"experimentRevision": revision, **extra})


def test_seed_boundaries_and_full_closed_loop():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        state = client.get("/api/app-state").json()["data"]
        assert len(state["claims"]) == 320
        assert [row["coveredExpense"] for row in state["claims"][:6]] == [199.0, 200.0, 200.01, 499.99, 500.0, 500.01]
        revision = state["experiment"]["revision"]

        stale = post(client, "/api/claims/CLM-SH-20260001/materials/confirm", revision - 1)
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "STALE_STATE"

        materials = post(client, "/api/claims/CLM-SH-20260001/materials/confirm", revision)
        assert materials.status_code == 200
        revision = materials.json()["data"]["experimentRevision"]

        review = post(
            client,
            "/api/evidence/EV-0001-diagnostic_image/image-reviews",
            revision,
            status="PASS",
            tagCode="MATERIAL_MATCH",
            tagLabel="材料一致",
            comment="",
            reviewer="测试审核员",
        )
        assert review.status_code == 200
        revision = review.json()["data"]["experimentRevision"]

        built = post(client, "/api/ontology/build", revision)
        assert built.status_code == 200
        revision = built.json()["data"]["experimentRevision"]
        focus = client.get("/api/ontology/focus/pet-master").json()["data"]
        assert focus["focusNode"]["id"] == "pet-master"
        assert len(focus["childNodes"]) == 5

        confirmed = post(client, "/api/ontology/confirm", revision)
        assert confirmed.status_code == 200
        revision = confirmed.json()["data"]["experimentRevision"]

        frozen = post(client, "/api/fact-snapshots/freeze", revision)
        assert frozen.status_code == 200
        frozen_data = frozen.json()["data"]
        revision = frozen_data["experimentRevision"]
        snapshot = frozen_data["snapshot"]
        assert snapshot["status"] == "FROZEN"
        assert len(snapshot["hash"]) == 64

        source = "上海地区急性肠胃炎案件，当可覆盖费用超过500元时给出不覆盖建议，否则给出覆盖建议；字段缺失时请求补件。"
        parsed = post(client, "/api/rules/parse-local", revision, sourceText=source)
        assert parsed.status_code == 200
        parsed_data = parsed.json()["data"]
        assert not [item for item in parsed_data["issues"] if item["level"] == "BLOCKING"]
        rule = parsed_data["rule"]

        strategy_response = post(
            client,
            "/api/strategies",
            revision,
            rule=rule,
            sourceText=source,
            parseSource="LOCAL_FALLBACK",
            parserVersion=parsed_data["parserVersion"],
        )
        assert strategy_response.status_code == 200, strategy_response.text
        strategy_data = strategy_response.json()["data"]
        revision = strategy_data["experimentRevision"]
        strategy_id = strategy_data["strategy"]["strategyId"]

        validation = post(client, f"/api/strategies/{strategy_id}/validation-confirmations", revision)
        assert validation.status_code == 200
        revision = validation.json()["data"]["experimentRevision"]

        simulation = post(client, "/api/simulations", revision)
        assert simulation.status_code == 200, simulation.text
        simulation_data = simulation.json()["data"]
        run = simulation_data["run"]
        revision = simulation_data["experimentRevision"]
        assert run["metrics"]["totalCases"] == 320
        assert len(run["rows"]) == 320
        assert run["metrics"]["affectedCases"] > 0

        repeat = post(client, "/api/simulations", revision)
        assert repeat.status_code == 200
        repeated_run = repeat.json()["data"]["run"]
        assert repeated_run["id"] == run["id"]
        assert repeated_run["metrics"] == run["metrics"]

        cases = client.get(f"/api/simulations/{run['id']}/cases", params={"changed": True}).json()["data"]
        assert cases["total"] == run["metrics"]["affectedCases"]
        assert client.get(f"/api/simulations/{run['id']}/report").status_code == 200
        assert client.get("/api/audit-events").json()["data"]["total"] >= 8


def test_upload_validation_and_hashing():
    with TestClient(app) as client:
        state = client.get("/api/app-state").json()["data"]
        revision = state["experiment"]["revision"]
        bad = client.post(
            "/api/claims/CLM-SH-20260001/evidence",
            data={"evidenceType": "invoice", "experimentRevision": revision},
            files={"file": ("bad.exe", io.BytesIO(b"no"), "application/octet-stream")},
        )
        assert bad.status_code == 415
        good = client.post(
            "/api/claims/CLM-SH-20260001/evidence",
            data={"evidenceType": "invoice", "experimentRevision": revision},
            files={"file": ("invoice.png", io.BytesIO(b"\x89PNG\r\nstrategy-sandbox"), "image/png")},
        )
        assert good.status_code == 200
        evidence = good.json()["data"]["evidence"]
        assert evidence["sourceHash"] == hashlib.sha256(b"\x89PNG\r\nstrategy-sandbox").hexdigest()
        next_revision = good.json()["data"]["experimentRevision"]
        duplicate = client.post(
            "/api/claims/CLM-SH-20260001/evidence",
            data={"evidenceType": "invoice", "experimentRevision": next_revision},
            files={"file": ("invoice-copy.png", io.BytesIO(b"\x89PNG\r\nstrategy-sandbox"), "image/png")},
        )
        assert duplicate.status_code == 409

