(function () {
  "use strict";

  const STORE = {
    solution: "strategy-sandbox:active-solution",
    creditRules: "strategy-sandbox:candidate-rules",
    petDataset: "strategy-sandbox:pet-gi:v1:dataset",
    petThreshold: "strategy-sandbox:pet-gi:v1:threshold",
    petRun: "strategy-sandbox:pet-gi:v2:last-run",
    petReviews: "strategy-sandbox:pet-gi:v1:image-reviews",
    petUploadMeta: "strategy-sandbox:pet-gi:v1:upload-meta",
    petWorkflow: "strategy-sandbox:pet-gi:v2:workflow",
    petConnections: "strategy-sandbox:pet-gi:v1:data-connections",
    petCandidateRule: "strategy-sandbox:pet-gi:v1:candidate-rule",
  };
  const PET_BACKEND_MARKER = "strategy-sandbox:pet-backend-version";
  if (localStorage.getItem(PET_BACKEND_MARKER) !== "v20") {
    [STORE.petDataset, STORE.petThreshold, STORE.petRun, STORE.petReviews, STORE.petUploadMeta, STORE.petWorkflow, STORE.petConnections, STORE.petCandidateRule]
      .forEach(key => localStorage.removeItem(key));
    localStorage.setItem(PET_BACKEND_MARKER, "v20");
  }

  const PET_BUSINESS_STORE_KEYS = new Set([STORE.petDataset, STORE.petThreshold, STORE.petRun, STORE.petReviews, STORE.petUploadMeta, STORE.petWorkflow, STORE.petConnections, STORE.petCandidateRule]);


  const BASELINE = Object.freeze({ id: "PET-GI-BASELINE-1.0", version: "1.0", region: "上海", diseaseCode: "GASTROENTERITIS", operator: ">", threshold: 200 });
  const CANDIDATE = Object.freeze({ id: "PET-GI-CANDIDATE-1.1", version: "1.1-draft", region: "上海", diseaseCode: "GASTROENTERITIS", operator: ">", threshold: 500 });
  const RULE_PARSER_VERSION = "PET-RULE-PARSER-1.0";
  const MODEL_PARSER_VERSION = "PET-MODEL-PARSER-1.0";
  const FACT_SCHEMA_VERSION = "PET-FACT-SCHEMA-1.0";
  const RULE_FIELDS = Object.freeze({
    covered_expense: { label: "可覆盖费用", property: "coveredExpense", valueType: "number", unit: "CNY", operators: [">", ">=", "<", "<=", "=", "!="] },
    deductible: { label: "免赔额", property: "deductible", valueType: "number", unit: "CNY", operators: [">", ">=", "<", "<=", "=", "!="] },
    reimbursement_rate: { label: "赔付比例", property: "reimbursementRate", valueType: "number", unit: "PERCENT", operators: [">", ">=", "<", "<=", "=", "!="] },
    remaining_limit: { label: "剩余额度", property: "remainingLimit", valueType: "number", unit: "CNY", operators: [">", ">=", "<", "<=", "=", "!="] },
    material_complete: { label: "材料完整度", property: "materialComplete", valueType: "boolean", unit: "BOOLEAN", operators: ["=", "!=", "IN", "NOT_IN"] },
    image_compliance: { label: "图片审核结论", property: "imageCompliance", valueType: "enum", unit: "IMAGE_REVIEW", operators: ["=", "!=", "IN", "NOT_IN"] },
  });
  const RULE_REGIONS = Object.freeze({ "上海": "上海", "杭州": "杭州", "苏州": "苏州", "南京": "南京", ALL: "全部地区" });
  const RULE_DISEASES = Object.freeze({ GASTROENTERITIS: "急性肠胃炎", DERMATITIS: "过敏性皮炎", URINARY_INFECTION: "泌尿系统感染", RESPIRATORY_INFECTION: "呼吸道感染", ALL: "全部疾病" });
  const COVERAGE_ACTIONS = Object.freeze({ INHERIT_BASELINE: "沿用现行建议", COVERED_RECOMMENDATION: "覆盖建议", NOT_COVERED_RECOMMENDATION: "不覆盖建议" });
  const ROUTE_ACTIONS = Object.freeze({ INHERIT_BASELINE: "沿用现行路由", AUTO_REVIEW: "自动审核", MANUAL_REVIEW: "人工复核", REQUEST_MORE: "请求补件" });
  const SNAPSHOT = Object.freeze({ id: "FS-PET-GI-SH-2026Q2-01", hash: "sha256:8f42c7a9e31d…91b6", dataset: "PET-SH-GI-2026Q2-v3", ocr: "OCR-DEMO-0.9.4", vision: "HUMAN-IMAGE-REVIEW-1.0", ontology: "PET-ONTOLOGY-1.0.0", frozenAt: "2026-08-14 09:30", seed: 20260814 });
  const DEFAULT_WORKFLOW = Object.freeze({ materialsRegistered: false, ocrValidated: false, imageReviewComplete: false, idMatched: false, ontologyBuilt: false, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null });
  const PET_DATASETS = [
    { id: "pet-sh-gi-2026q2-v3", name: "上海宠物险肠胃炎理赔 · 2026 Q2", rows: 320, facts: 4872, evidence: 1684, coverage: 98.2, maturity: 94.1, frozen: true },
  ];
  const MATURITY = { OBSERVED_REPLAY: ["历史回放", "observed"], ESTIMATE: ["估算", "estimate"], ASSUMPTION: ["业务假设", "assumption"], EXPERIMENT_DESIGN: ["实验设计", "experiment"] };
  const IMAGE_REVIEW_TAGS = Object.freeze([
    { code: "MATERIAL_MATCH", label: "材料一致", statuses: ["PASS"] },
    { code: "IMAGE_BLUR", label: "图像模糊", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "SUBJECT_MISMATCH", label: "主体不一致", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "SITE_MISMATCH", label: "诊疗部位不匹配", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "DATE_ANOMALY", label: "日期异常", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "SUSPECT_DUPLICATE", label: "疑似重复", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "OTHER_ANOMALY", label: "其他异常", statuses: ["FAIL", "NEEDS_REVIEW"] },
    { code: "INSUFFICIENT", label: "信息不足", statuses: ["NEEDS_REVIEW"] },
  ]);
  const CONNECTION_MAX = 5;
  const CONNECTION_BUSINESS = Object.freeze({
    insurance: { label: "保险", platformType: "保险平台", kind: "insurance", categories: ["投保信息", "保单", "理赔记录", "责任配置"] },
    medical: { label: "医疗", platformType: "医疗平台", kind: "medical", categories: ["宠物主档", "就诊记录", "诊断与检验", "费用明细"] },
    payment: { label: "支付", platformType: "支付平台", kind: "payment", categories: ["支付订单", "收款账户", "退款记录", "相似交易"] },
    registry: { label: "宠物档案", platformType: "宠物登记平台", kind: "registry", categories: ["宠物身份", "芯片登记", "主人档案", "家系关系"] },
    other: { label: "其他", platformType: "其他平台", kind: "other", categories: ["主数据", "事件记录", "关联索引"] },
  });
  const CONNECTION_MATCH_KEYS = Object.freeze({
    chip: "芯片号或平台宠物编号精确匹配",
    policy: "保单登记宠物与平台档案匹配",
    composite: "宠物名称、品种、生日与主人信息组合匹配",
  });
  const CREDIT_BASE = Object.freeze({ version: "v1.6", overdueCount: 3, maxOverdueDays: 90, dtiPercent: 80 });
  const CREDIT_NEXT = Object.freeze({ version: "v1.7-draft", overdueCount: 2, maxOverdueDays: 60, dtiPercent: 70 });

  const petNav = [["/pet/intake", "材料审核", "scan"], ["/pet/graph", "本体图谱", "nodes"], ["/pet/datasets", "数据快照", "database"], ["/pet/strategies", "策略实验", "sliders"], ["/pet/validation", "规则检查", "check"], ["/pet/simulation", "仿真总览", "chart"], ["/pet/cases", "案例追踪", "files"]];
  const creditNav = [["/credit/datasets", "数据集", "database"], ["/credit/strategies", "策略", "sliders"], ["/credit/validation", "检查", "check"], ["/credit/simulation", "仿真", "chart"], ["/credit/cases", "案例", "files"]];
  const legacy = { "/datasets": "/credit/datasets", "/strategies": "/credit/strategies", "/validation": "/credit/validation", "/simulation": "/credit/simulation", "/cases": "/credit/cases", "/pet/review": "/pet/intake" };

  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  const modalRoot = document.getElementById("modal-root");
  const petClaims = generatePetClaims(320);
  const creditApplicants = generateCreditApplicants(1200);
  const storedThreshold = Number(readStore(STORE.petThreshold, 500));
  const storedRun = readStore(STORE.petRun, null);
  const storedPetWorkflow = readStore(STORE.petWorkflow, {});
  const storedConnections = sanitizeStoredConnections(readStore(STORE.petConnections, []));
  const storedCandidateRule = sanitizeCandidateRule(readStore(STORE.petCandidateRule, null), storedThreshold);
  const migratedPetWorkflow = {
    ...DEFAULT_WORKFLOW,
    ...storedPetWorkflow,
    ontologyBuilt: storedPetWorkflow.ontologyBuilt ?? storedPetWorkflow.oagBuilt ?? false,
    ontologyConfirmed: storedPetWorkflow.ontologyConfirmed ?? storedPetWorkflow.oagConfirmed ?? false,
  };
  delete migratedPetWorkflow.oagBuilt;
  delete migratedPetWorkflow.oagConfirmed;
  const petState = {
    backendReady: false, backendBusy: false, experimentRevision: 0, backendSnapshot: null, backendValidation: null, activeStrategyId: null,
    dataset: PET_DATASETS[0].id, run: null, running: false,
    candidateRule: storedCandidateRule, ruleDraft: cloneRule(storedCandidateRule), ruleSource: storedCandidateRule.sourceText, ruleParsed: false, ruleParsing: false, ruleDraftConfirmed: true, parseRequestId: 0,
    modelSettings: { loading: true, configured: false, baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", timeoutMs: 30000, keyMasked: "", source: "NONE", lastTest: null },
    modelSettingsDraft: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "", timeoutMs: 30000 },
    modelSettingsBusy: false, modelSettingsError: "", modelParseError: "", modelParseMeta: null, settingsReturnPath: "/pet/strategies",
    selectedClaimId: "CLM-SH-20260001", selectedEvidenceId: "record", focusNodeId: "pet-master", graphAnimating: false,
    reviews: readStore(STORE.petReviews, {}), reviewDraft: {}, uploadMeta: readStore(STORE.petUploadMeta, []), sessionUploads: [],
    connections: storedConnections, connectionModalOpen: false, connectionDraft: null, connectionTest: null, connectionTesting: false, connectionTestRequestId: 0, connectionReturnFocus: null, newConnectionId: null,
    workflow: migratedPetWorkflow,
    filters: { transition: "CHANGED", recommendation: "ALL", region: "ALL", search: "" }, casePage: 0,
  };
  const activeConnectionFingerprint = dataConnectionFingerprint();
  if ((petState.connections.length || petState.workflow.connectionFingerprint) && petState.workflow.connectionFingerprint !== activeConnectionFingerprint) {
    Object.assign(petState.workflow, { ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: activeConnectionFingerprint });
    petState.run = null; removeStore(STORE.petRun); persistWorkflow();
  }
  writeStore(STORE.petDataset, petState.dataset);
  if (storedRun && petState.workflow.snapshotFrozen && petState.workflow.validationPassed && petState.candidateRule.factSnapshotHash === snapshotHash() && storedRun.snapshot === snapshotId() && storedRun.hash === snapshotHash() && storedRun.ruleHash === candidateRuleHash(petState.candidateRule)) petState.run = calculatePetSimulation(petState.candidateRule, storedRun.timestamp);
  const savedCredit = readStore(STORE.creditRules, CREDIT_NEXT);
  const creditState = { rules: Number.isFinite(Number(savedCredit?.overdueCount)) ? { ...CREDIT_NEXT, ...savedCredit } : { ...CREDIT_NEXT }, draft: null, run: null };
  creditState.draft = { ...creditState.rules };
  creditState.run = calculateCreditSimulation(creditState.rules);

  function readStore(key, fallback) { if (PET_BUSINESS_STORE_KEYS.has(key)) return fallback; try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
  function writeStore(key, value) { if (PET_BUSINESS_STORE_KEYS.has(key)) return; try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function removeStore(key) { if (PET_BUSINESS_STORE_KEYS.has(key)) return; try { localStorage.removeItem(key); } catch (_) {} }
  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function number(value, digits = 0) { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
  function money(value, digits = 0) { return `¥${number(value, digits)}`; }
  function pct(value, digits = 1) { return `${Number(value).toFixed(digits)}%`; }
  function shortMoney(value) { return Math.abs(value) >= 10000 ? `¥${(value / 10000).toFixed(1)}万` : money(value); }
  function signed(value, formatter = number) { return Math.abs(value) < 0.0001 ? "无变化" : `${value > 0 ? "+" : "−"}${formatter(Math.abs(value))}`; }
  function seededRandom(seed) { let value = seed >>> 0; return () => { value += 0x6d2b79f5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
  function stableHash(input) { let hash = 2166136261; for (const char of String(input)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return Math.abs(hash >>> 0).toString(16).padStart(8, "0"); }

  function cloneRule(rule) { return JSON.parse(JSON.stringify(rule)); }
  function defaultCandidateRule(threshold = 500) {
    const safeThreshold = Number.isFinite(Number(threshold)) && Number(threshold) > 0 ? Number(threshold) : 500;
    return {
      id: CANDIDATE.id, version: CANDIDATE.version,
      sourceText: `上海地区急性肠胃炎案件，当可覆盖费用超过${safeThreshold}元时给出不覆盖建议，否则给出覆盖建议；字段缺失时请求补件。`,
      parserVersion: RULE_PARSER_VERSION,
      scope: { region: "上海", diseaseCode: "GASTROENTERITIS" },
      logic: "AND",
      conditions: [{ id: "condition-1", field: "covered_expense", operator: ">", value: safeThreshold, valueType: "number", unit: "CNY", needsConfirmation: false }],
      thenActions: { coverageRecommendation: "NOT_COVERED_RECOMMENDATION", processingRoute: "INHERIT_BASELINE" },
      elseActions: { coverageRecommendation: "COVERED_RECOMMENDATION", processingRoute: "INHERIT_BASELINE" },
      onMissing: "REQUEST_MORE", parserFlags: [], factSnapshotHash: null, confirmedAt: null,
    };
  }
  function sanitizeCandidateRule(value, fallbackThreshold = 500) {
    const fallback = defaultCandidateRule(fallbackThreshold);
    if (!value || typeof value !== "object") return fallback;
    const scope = value.scope && typeof value.scope === "object" ? value.scope : {};
    const region = RULE_REGIONS[scope.region] ? scope.region : fallback.scope.region;
    const diseaseCode = RULE_DISEASES[scope.diseaseCode] ? scope.diseaseCode : fallback.scope.diseaseCode;
    const conditions = Array.isArray(value.conditions) ? value.conditions.slice(0, 8).map((condition, indexValue) => {
      const field = RULE_FIELDS[condition?.field] ? condition.field : null;
      if (!field) return null;
      const meta = RULE_FIELDS[field], operator = meta.operators.includes(condition.operator) ? condition.operator : meta.operators[0];
      let normalizedValue = condition.value;
      const collectionOperator = ["IN", "NOT_IN"].includes(operator), allowedEnum = ["PASS", "FAIL", "NEEDS_REVIEW"];
      if (meta.valueType === "number") normalizedValue = condition.value === "" || condition.value == null ? NaN : Number(condition.value);
      if (meta.valueType === "boolean") {
        const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value];
        normalizedValue = collectionOperator ? rawValues.map(item => item === true || item === "true") : (condition.value === true || condition.value === "true");
      }
      if (meta.valueType === "enum") {
        const rawValues = (Array.isArray(condition.value) ? condition.value : String(condition.value ?? "").split(",")).map(String).map(item => item.trim()).filter(item => allowedEnum.includes(item));
        normalizedValue = collectionOperator ? [...new Set(rawValues)] : (rawValues[0] || "PASS");
      }
      if (meta.valueType === "number" && !Number.isFinite(normalizedValue)) return null;
      if (collectionOperator && Array.isArray(normalizedValue) && !normalizedValue.length) return null;
      return { id: String(condition.id || `condition-${indexValue + 1}`), field, operator, value: normalizedValue, valueType: meta.valueType, unit: meta.unit, needsConfirmation: false };
    }).filter(Boolean) : [];
    const coverageValues = Object.keys(COVERAGE_ACTIONS), routeValues = Object.keys(ROUTE_ACTIONS);
    const normalizeActions = actions => ({
      coverageRecommendation: coverageValues.includes(actions?.coverageRecommendation) ? actions.coverageRecommendation : "INHERIT_BASELINE",
      processingRoute: routeValues.includes(actions?.processingRoute) ? actions.processingRoute : "INHERIT_BASELINE",
    });
    return {
      id: CANDIDATE.id, version: CANDIDATE.version,
      sourceText: String(value.sourceText || fallback.sourceText).slice(0, 1200), parserVersion: value.parseSource === "MODEL" ? MODEL_PARSER_VERSION : RULE_PARSER_VERSION,
      scope: { region, diseaseCode }, logic: value.logic === "OR" ? "OR" : "AND",
      conditions: conditions.length ? conditions : fallback.conditions,
      thenActions: normalizeActions(value.thenActions),
      elseActions: normalizeActions(value.elseActions),
      onMissing: ["NO_MATCH", "REQUEST_MORE"].includes(value.onMissing) ? value.onMissing : fallback.onMissing,
      parserFlags: [], confirmedRuleText: String(value.confirmedRuleText || "").slice(0, 1200), factSnapshotHash: value.factSnapshotHash || null, confirmedAt: value.confirmedAt || null,
      parseSource: value.parseSource === "MODEL" ? "MODEL" : value.parseSource === "LOCAL_FALLBACK" ? "LOCAL_FALLBACK" : null,
      modelName: String(value.modelName || "").slice(0, 120), modelRequestId: String(value.modelRequestId || "").slice(0, 120),
      modelParsedAt: value.modelParsedAt || null, warnings: Array.isArray(value.warnings) ? value.warnings.map(String).slice(0, 8) : [],
    };
  }
  function candidateRuleHash(rule) {
    const safe = sanitizeCandidateRule(rule, 500);
    return stableHash(JSON.stringify({ scope: safe.scope, logic: safe.logic, conditions: safe.conditions.map(({ field, operator, value }) => ({ field, operator, value })), thenActions: safe.thenActions, elseActions: safe.elseActions, onMissing: safe.onMissing, snapshot: safe.factSnapshotHash }));
  }
  function ruleIssue(code, level, target, message, suggestedFix) { return { code, level, target, message, suggestedFix }; }
  function parseOperator(segment) {
    const definitions = [
      { pattern: /不少于|不低于|至少|大于等于|>=|≥/, operator: ">=" },
      { pattern: /不多于|不高于|至多|小于等于|<=|≤/, operator: "<=" },
      { pattern: /不等于|!=|≠/, operator: "!=" },
      { pattern: /超过|大于|>/, operator: ">" },
      { pattern: /低于|小于|</, operator: "<" },
      { pattern: /等于|为|=/, operator: "=" },
    ];
    for (const definition of definitions) if (definition.pattern.test(segment)) return { operator: definition.operator, ambiguous: false };
    if (/以上/.test(segment)) return { operator: ">=", ambiguous: true };
    if (/以下/.test(segment)) return { operator: "<=", ambiguous: true };
    return { operator: "", ambiguous: false };
  }
  function parseActionClause(text) {
    const source = String(text || "");
    let coverageRecommendation = "INHERIT_BASELINE", processingRoute = "INHERIT_BASELINE";
    if (/不覆盖建议|不予覆盖建议/.test(source)) coverageRecommendation = "NOT_COVERED_RECOMMENDATION";
    else if (/覆盖建议/.test(source)) coverageRecommendation = "COVERED_RECOMMENDATION";
    if (/请求补件|补充材料|进入补件|补件/.test(source)) processingRoute = "REQUEST_MORE";
    else if (/人工复核|人工审核/.test(source)) processingRoute = "MANUAL_REVIEW";
    else if (/自动审核|自动处理/.test(source)) processingRoute = "AUTO_REVIEW";
    return { coverageRecommendation, processingRoute };
  }
  function parseNaturalLanguageRule(sourceText) {
    const source = String(sourceText || "").trim(), parserFlags = [], conditions = [];
    const regionMatches = Object.keys(RULE_REGIONS).filter(key => key !== "ALL" && source.includes(key));
    const region = regionMatches[0] || (/全部地区|全国/.test(source) ? "ALL" : "");
    const diseaseAliases = [
      ["GASTROENTERITIS", /急性肠胃炎|肠胃炎/], ["DERMATITIS", /过敏性皮炎|皮炎/],
      ["URINARY_INFECTION", /泌尿系统感染|泌尿感染/], ["RESPIRATORY_INFECTION", /呼吸道感染/],
    ];
    const diseaseMatches = diseaseAliases.filter(([, pattern]) => pattern.test(source)).map(([code]) => code);
    const diseaseCode = diseaseMatches[0] || (/全部疾病|所有病种/.test(source) ? "ALL" : "");
    if (regionMatches.length > 1 || diseaseMatches.length > 1) parserFlags.push("MULTIPLE_SCOPE");

    const missingMarker = source.match(/字段缺失|空值|信息缺失/), ruleBody = missingMarker ? source.slice(0, missingMarker.index) : source;
    const conditionStartMatch = ruleBody.match(/(?:当|若|如果)/);
    let conditionStart = conditionStartMatch ? conditionStartMatch.index + conditionStartMatch[0].length : 0;
    if (!conditionStartMatch) {
      const aliases = ["可覆盖费用", "保障费用", "covered_expense", "免赔额", "deductible", "赔付比例", "报销比例", "reimbursement_rate", "剩余额度", "可用额度", "remaining_limit", "材料完整", "资料完整", "材料缺失", "资料缺失", "material_complete", "图片审核", "诊疗图片", "image_compliance"];
      const positions = aliases.map(alias => ruleBody.toLowerCase().indexOf(alias.toLowerCase())).filter(indexValue => indexValue >= 0);
      conditionStart = positions.length ? Math.min(...positions) : 0;
    }
    const afterStart = ruleBody.slice(conditionStart), actionDelimiter = afterStart.match(/(?:时|则|，|,)\s*(?=给出|输出|进入|请求|补充|人工|自动|不覆盖|覆盖|沿用)/);
    const conditionText = actionDelimiter ? afterStart.slice(0, actionDelimiter.index) : afterStart;
    const normalizedConditionText = conditionText.replace(/大于或等于/g, "大于等于").replace(/小于或等于/g, "小于等于");
    const connectorPattern = /并且|同时|以及|或者|或是|且|或|\bAND\b|\bOR\b/gi;
    const connectors = [...normalizedConditionText.matchAll(connectorPattern)].map(match => /或者|或是|^或$|OR/i.test(match[0]) ? "OR" : "AND");
    const hasAnd = connectors.includes("AND"), hasOr = connectors.includes("OR"), logic = hasOr && !hasAnd ? "OR" : "AND";
    if (hasAnd && hasOr) parserFlags.push("MIXED_LOGIC");
    if (/[（）()]/.test(ruleBody)) parserFlags.push("NESTED_LOGIC");
    const rejectCheck = source.replace(/(?:不得|不能|不可|不允许|禁止)(?:自动|直接|最终)?拒赔/g, "");
    if (/自动拒赔|直接拒赔|拒绝赔付|最终拒赔|拒赔/.test(rejectCheck)) parserFlags.push("FORBIDDEN_REJECT");
    if (/左右|偏高|偏低|较高|较低|较大|较小/.test(conditionText)) parserFlags.push("VAGUE_VALUE");

    const numericDefinitions = [
      ["covered_expense", ["可覆盖费用", "保障费用", "covered_expense"]],
      ["deductible", ["免赔额", "deductible"]],
      ["reimbursement_rate", ["赔付比例", "报销比例", "reimbursement_rate"]],
      ["remaining_limit", ["剩余额度", "可用额度", "remaining_limit"]],
    ];
    const clauses = normalizedConditionText.split(connectorPattern).map(item => item.trim()).filter(Boolean);
    let previousNumericField = "";
    clauses.forEach(clause => {
      let parsed = false;
      let numericField = "";
      for (const [field, aliases] of numericDefinitions) {
        if (aliases.some(alias => clause.toLowerCase().includes(alias.toLowerCase()))) { numericField = field; break; }
      }
      if (!numericField && previousNumericField && /(?:>|<|=|≥|≤|超过|大于|小于|不低于|不少于|不高于|不多于|至少|至多|以上|以下)\s*-?\d/.test(clause)) numericField = previousNumericField;
      if (numericField) {
        const operatorInfo = parseOperator(clause), valueMatch = clause.match(/-?\d+(?:\.\d+)?/), meta = RULE_FIELDS[numericField];
        if ((numericField === "reimbursement_rate" && /元|¥|人民币/.test(clause)) || (numericField !== "reimbursement_rate" && /%|百分之/.test(clause))) parserFlags.push("UNIT_MISMATCH");
        conditions.push({ id: "condition-" + (conditions.length + 1), field: numericField, operator: operatorInfo.operator, value: valueMatch ? Number(valueMatch[0]) : "", valueType: "number", unit: meta.unit, needsConfirmation: operatorInfo.ambiguous });
        previousNumericField = numericField; parsed = true;
      }
      if (/材料完整|资料完整|材料不完整|资料不完整|材料缺失|资料缺失|material_complete/i.test(clause)) {
        const negative = /材料不完整|资料不完整|材料缺失|资料缺失/.test(clause);
        conditions.push({ id: "condition-" + (conditions.length + 1), field: "material_complete", operator: "=", value: !negative, valueType: "boolean", unit: "BOOLEAN", needsConfirmation: false });
        parsed = true;
      }
      if (/图片审核|诊疗图片|image_compliance/i.test(clause)) {
        const values = [];
        if (/不通过|失败|\bFAIL\b/i.test(clause)) values.push("FAIL");
        if (/需复核|待复核|\bNEEDS_REVIEW\b/i.test(clause)) values.push("NEEDS_REVIEW");
        const passText = clause.replace(/不通过/g, "");
        if (/审核通过|图片通过|图像通过|合格|\bPASS\b/i.test(passText)) values.push("PASS");
        const uniqueValues = [...new Set(values)];
        conditions.push({ id: "condition-" + (conditions.length + 1), field: "image_compliance", operator: uniqueValues.length > 1 ? "IN" : "=", value: uniqueValues.length > 1 ? uniqueValues : (uniqueValues[0] || ""), valueType: "enum", unit: "IMAGE_REVIEW", needsConfirmation: false });
        parsed = true;
      }
      if (!parsed && /(?:>|<|=|≥|≤|超过|大于|小于|不低于|不少于|不高于|不多于|至少|至多|以上|以下)\s*-?\d/.test(clause)) parserFlags.push("UNKNOWN_FIELD");
    });

    const elseMatch = ruleBody.match(/否则|未命中时|条件不满足时/), thenText = elseMatch ? ruleBody.slice(0, elseMatch.index) : ruleBody, elseText = elseMatch ? ruleBody.slice((elseMatch.index || 0) + elseMatch[0].length) : "";
    const thenActions = parseActionClause(thenText), elseActions = elseMatch ? parseActionClause(elseText) : { coverageRecommendation: "", processingRoute: "" };
    const missingText = missingMarker ? source.slice(missingMarker.index) : "";
    const onMissing = missingMarker ? (/请求补件|补充材料|进入补件|补件/.test(missingText) ? "REQUEST_MORE" : /不命中|按未命中/.test(missingText) ? "NO_MATCH" : "") : "";
    return {
      id: CANDIDATE.id, version: CANDIDATE.version, sourceText: source, parserVersion: RULE_PARSER_VERSION,
      scope: { region, diseaseCode }, logic, conditions, thenActions, elseActions, onMissing,
      parserFlags: [...new Set(parserFlags)], factSnapshotHash: snapshotHash(), confirmedAt: null,
    };
  }  function validateCandidateRule(rule) {
    const issues = [], scope = rule?.scope || {}, conditions = Array.isArray(rule?.conditions) ? rule.conditions : [], flags = new Set(rule?.parserFlags || []);
    if (!RULE_REGIONS[scope.region]) issues.push(ruleIssue("SCOPE_REGION", "BLOCKING", "scope.region", "尚未明确适用地区", "选择具体地区或全部地区"));
    if (!RULE_DISEASES[scope.diseaseCode]) issues.push(ruleIssue("SCOPE_DISEASE", "BLOCKING", "scope.diseaseCode", "尚未明确适用疾病", "选择具体疾病或全部疾病"));
    if (flags.has("MULTIPLE_SCOPE")) issues.push(ruleIssue("MULTIPLE_SCOPE", "BLOCKING", "scope", "检测到多个地区或疾病范围", "只保留一个范围，或明确选择全部"));
    if (!["AND", "OR"].includes(rule?.logic)) issues.push(ruleIssue("LOGIC", "BLOCKING", "logic", "条件逻辑必须明确为AND或OR", "选择一种统一逻辑"));
    if (flags.has("MIXED_LOGIC")) issues.push(ruleIssue("MIXED_LOGIC", "BLOCKING", "logic", "检测到AND与OR混用", "改为统一AND或统一OR"));
    if (flags.has("NESTED_LOGIC")) issues.push(ruleIssue("NESTED_LOGIC", "BLOCKING", "logic", "首版不支持括号或嵌套条件组", "拆分为单层条件"));
    if (flags.has("FORBIDDEN_REJECT")) issues.push(ruleIssue("FORBIDDEN_REJECT", "BLOCKING", "action", "自然语言规则不能生成最终拒赔", "改为不覆盖建议或人工复核"));
    if (flags.has("VAGUE_VALUE")) issues.push(ruleIssue("VAGUE_VALUE", "BLOCKING", "conditions", "检测到“左右、偏高”等不精确阈值", "输入精确数值和运算符"));
    if (flags.has("UNIT_MISMATCH")) issues.push(ruleIssue("UNIT_MISMATCH", "BLOCKING", "conditions", "条件数值单位与字段类型不匹配", "金额使用元，赔付比例使用百分比"));
    if (flags.has("UNKNOWN_FIELD")) issues.push(ruleIssue("UNKNOWN_FIELD", "BLOCKING", "conditions", "检测到白名单外的条件字段", "改用案件与材料事实白名单字段"));
    if (!conditions.length) issues.push(ruleIssue("NO_CONDITION", "BLOCKING", "conditions", "没有识别到可执行条件", "添加一个白名单业务字段"));
    conditions.forEach((condition, indexValue) => {
      const meta = RULE_FIELDS[condition.field], target = "conditions." + indexValue;
      if (!meta) { issues.push(ruleIssue("UNKNOWN_FIELD", "BLOCKING", target, "条件字段不在白名单内", "重新选择业务字段")); return; }
      if (!meta.operators.includes(condition.operator)) issues.push(ruleIssue("OPERATOR", "BLOCKING", target, meta.label + "的运算符无效", "选择兼容运算符"));
      if (meta.valueType === "number") {
        const blank = condition.value === "" || condition.value == null, numericValue = Number(condition.value);
        if (blank || !Number.isFinite(numericValue)) issues.push(ruleIssue("VALUE", "BLOCKING", target, meta.label + "缺少有效数值", "输入明确阈值"));
        else if (numericValue < 0 || (condition.field === "reimbursement_rate" && numericValue > 100)) issues.push(ruleIssue("VALUE_RANGE", "BLOCKING", target, meta.label + "超出允许范围", condition.field === "reimbursement_rate" ? "输入0至100的百分比" : "输入大于或等于0的金额"));
      }
      if (meta.valueType === "enum") {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value], allowed = ["PASS", "FAIL", "NEEDS_REVIEW"];
        if (!values.length || values.some(value => !allowed.includes(String(value)))) issues.push(ruleIssue("VALUE", "BLOCKING", target, "图片审核结论无效", "选择PASS、FAIL或NEEDS_REVIEW"));
        if (["IN", "NOT_IN"].includes(condition.operator) && values.length < 2) issues.push(ruleIssue("SET_VALUE", "BLOCKING", target, "集合判断至少需要两个枚举值", "选择两个或更多审核结论"));
      }
      if (meta.valueType === "boolean") {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value];
        if (!values.length || values.some(value => ![true, false, "true", "false"].includes(value))) issues.push(ruleIssue("VALUE", "BLOCKING", target, "材料完整度必须为是或否", "选择明确布尔值"));
        if (["IN", "NOT_IN"].includes(condition.operator) && values.length < 2) issues.push(ruleIssue("SET_VALUE", "BLOCKING", target, "集合判断至少需要两个布尔值", "选择是和否，或改用等于/不等于"));
      }
      if (condition.needsConfirmation) issues.push(ruleIssue("AMBIGUOUS_OPERATOR", "BLOCKING", target, meta.label + "使用“以上/以下”，需要确认是否包含边界", "重新选择>、>=、<或<="));
    });
    if (!["NO_MATCH", "REQUEST_MORE"].includes(rule?.onMissing)) issues.push(ruleIssue("NULL_POLICY", "BLOCKING", "onMissing", "尚未声明字段空值处理", "选择按未命中处理或请求补件"));
    const thenActions = rule?.thenActions || {}, elseActions = rule?.elseActions || {};
    const thenCoverageValid = Object.hasOwn(COVERAGE_ACTIONS, thenActions.coverageRecommendation), thenRouteValid = Object.hasOwn(ROUTE_ACTIONS, thenActions.processingRoute);
    const elseCoverageValid = Object.hasOwn(COVERAGE_ACTIONS, elseActions.coverageRecommendation), elseRouteValid = Object.hasOwn(ROUTE_ACTIONS, elseActions.processingRoute);
    if (!thenCoverageValid || !thenRouteValid) issues.push(ruleIssue("THEN_ACTION", "BLOCKING", "thenActions", "命中动作不完整", "补充保障建议与处理路由"));
    if (!elseCoverageValid || !elseRouteValid) issues.push(ruleIssue("ELSE_ACTION", "BLOCKING", "elseActions", "未命中动作不完整", "明确选择保障建议与处理路由，可选择沿用现行"));
    if (thenCoverageValid && thenRouteValid && elseCoverageValid && elseRouteValid && [thenActions.coverageRecommendation, thenActions.processingRoute, elseActions.coverageRecommendation, elseActions.processingRoute].every(value => value === "INHERIT_BASELINE")) issues.push(ruleIssue("NO_EFFECT", "BLOCKING", "thenActions", "规则两个分支都沿用现行，没有策略变化", "至少修改一个保障建议或处理路由"));
    const hasEvidenceCondition = conditions.some(condition => ["material_complete", "image_compliance"].includes(condition.field));
    if (hasEvidenceCondition) {
      const branchActions = [thenActions, elseActions];
      if (branchActions.some(actions => Object.hasOwn(COVERAGE_ACTIONS, actions.coverageRecommendation) && actions.coverageRecommendation !== "INHERIT_BASELINE")) issues.push(ruleIssue("EVIDENCE_PERMISSION", "BLOCKING", "actions.coverageRecommendation", "材料或图片事实只能改变处理路由", "两个分支的保障建议都设为沿用现行"));
      if (branchActions.some(actions => actions.processingRoute === "AUTO_REVIEW")) issues.push(ruleIssue("EVIDENCE_AUTO_ROUTE", "BLOCKING", "actions.processingRoute", "材料或图片事实不能直接进入自动审核", "改为人工复核、请求补件或沿用现行"));
    }
    if (new Set(conditions.map(condition => condition.field)).size < conditions.length) issues.push(ruleIssue("DUPLICATE_FIELD", "WARNING", "conditions", "同一字段出现多个条件，请确认逻辑关系", "核对是否确实需要重复条件"));
    return issues;
  }  function conditionLabel(condition) {
    const meta = RULE_FIELDS[condition.field], raw = condition.value;
    const formatOne = item => meta?.unit === "CNY" ? money(Number(item), Number(item) % 1 ? 2 : 0) : meta?.unit === "PERCENT" ? number(Number(item), Number(item) % 1 ? 1 : 0) + "%" : meta?.valueType === "boolean" ? (item === true || item === "true" ? "是" : "否") : String(item || "未设置");
    const value = Array.isArray(raw) ? raw.map(formatOne).join(" / ") : formatOne(raw);
    return (meta?.label || condition.field) + " " + (condition.operator || "?") + " " + value;
  }  function ruleScopeLabel(rule) { return `${RULE_REGIONS[rule?.scope?.region] || "地区待确认"} / ${RULE_DISEASES[rule?.scope?.diseaseCode] || "疾病待确认"}`; }
  function ruleSummary(rule) {
    const conditions = (rule?.conditions || []).map(conditionLabel).join(` ${rule?.logic || "AND"} `) || "条件待解析";
    return `${ruleScopeLabel(rule)} · ${conditions}`;
  }
  function actionSummary(actions) {
    return `${COVERAGE_ACTIONS[actions?.coverageRecommendation] || "保障建议待确认"} · ${ROUTE_ACTIONS[actions?.processingRoute] || "处理路由待确认"}`;
  }
  function candidateDelta(rule) {
    const threshold = candidateThreshold(rule);
    return threshold != null
      ? `covered_expense > ${BASELINE.threshold} → > ${number(threshold, Number(threshold) % 1 ? 2 : 0)}`
      : `现行单阈值 → ${rule?.conditions?.length || 0} 条${rule?.logic || "AND"}组合条件`;
  }
  function compileRuleDsl(rule) {
    const scopeRegion = rule?.scope?.region === "ALL" ? "*" : JSON.stringify(rule?.scope?.region || "UNRESOLVED");
    const scopeDisease = rule?.scope?.diseaseCode === "ALL" ? "*" : JSON.stringify(rule?.scope?.diseaseCode || "UNRESOLVED");
    const conditionDsl = (rule?.conditions || []).map(condition => {
      const meta = RULE_FIELDS[condition.field], value = meta?.valueType === "number" ? Number(condition.value) : JSON.stringify(condition.value);
      return `${condition.field || "UNKNOWN_FIELD"} ${condition.operator || "?"} ${value}`;
    }).join(`\n  ${rule?.logic || "AND"} `) || "UNRESOLVED_CONDITION";
    const actionLine = actions => `recommendation = "${actions?.coverageRecommendation || "UNRESOLVED"}"; route = "${actions?.processingRoute || "UNRESOLVED"}"`;
    return `RULE ${rule?.id || CANDIDATE.id}\nSCOPE region == ${scopeRegion} AND disease == ${scopeDisease}\nWHEN ${conditionDsl}\nTHEN ${actionLine(rule?.thenActions)}\nELSE ${actionLine(rule?.elseActions)}\nON_MISSING = "${rule?.onMissing || "UNRESOLVED"}"\nEXECUTION_MODE = "SIMULATED"\nPARSER = "${RULE_PARSER_VERSION}"\nFACT_SNAPSHOT = "${snapshotId()}"`;
  }
  function isStandardThresholdRule(rule) {
    const condition = rule?.conditions?.[0];
    return rule?.conditions?.length === 1 && rule.logic === "AND" && rule.scope?.region === "上海" && rule.scope?.diseaseCode === "GASTROENTERITIS" &&
      condition?.field === "covered_expense" && condition?.operator === ">" && Number.isFinite(Number(condition?.value)) && Number(condition.value) >= 0 &&
      rule.thenActions?.coverageRecommendation === "NOT_COVERED_RECOMMENDATION" && rule.elseActions?.coverageRecommendation === "COVERED_RECOMMENDATION" &&
      rule.thenActions?.processingRoute === "INHERIT_BASELINE" && rule.elseActions?.processingRoute === "INHERIT_BASELINE";
  }  function candidateThreshold(rule) { return isStandardThresholdRule(rule) ? Number(rule.conditions[0].value) : null; }

  function defaultConnectionDraft(sourceKind = "database") {
    if (sourceKind === "platform") return { sourceKind: "platform", name: "", businessType: "medical", matchKey: "chip", connectorType: "REST API", endpoint: "https://api.example.com/v1", authType: "Token", appId: "", secret: "" };
    return { sourceKind: "database", name: "", businessType: "medical", matchKey: "chip", connectorType: "PostgreSQL", host: "", port: "5432", database: "", schema: "public", username: "", secret: "" };
  }

  function sanitizeStoredConnections(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && /^external-[a-f0-9]{8}$/.test(String(item.id || ""))).slice(0, CONNECTION_MAX).map(item => ({
      id: String(item.id), sourceKind: item.sourceKind === "platform" ? "platform" : "database", name: String(item.name || "外接数据源").slice(0, 40),
      businessType: CONNECTION_BUSINESS[item.businessType] ? item.businessType : "other", connectorType: String(item.connectorType || "").slice(0, 24),
      endpointMasked: String(item.endpointMasked || "已脱敏").slice(0, 100), status: "CONNECTED", matchKey: CONNECTION_MATCH_KEYS[item.matchKey] ? item.matchKey : "composite",
      matchMethod: String(item.matchMethod || CONNECTION_MATCH_KEYS.composite).slice(0, 80), confidence: Math.max(.5, Math.min(1, Number(item.confidence) || .8)),
      categories: Array.isArray(item.categories) ? item.categories.slice(0, 6).map(categoryItem => ({ label: String(categoryItem.label || "数据记录").slice(0, 24), count: Math.max(1, Math.min(9, Number(categoryItem.count) || 1)) })) : [],
      dataVersion: String(item.dataVersion || "EXT-v1").slice(0, 30), syncedAt: String(item.syncedAt || "2026-08-16 09:30:00").slice(0, 30),
      fingerprint: String(item.fingerprint || stableHash(item.id)).slice(0, 32), connectedAt: String(item.connectedAt || item.syncedAt || "2026-08-16 09:30:00").slice(0, 30),
    }));
  }

  function connectionEndpoint(draft) {
    if (draft.sourceKind === "platform") return String(draft.endpoint || "").trim();
    return String(draft.host || "").trim() + ":" + String(draft.port || "").trim() + "/" + String(draft.database || "").trim() + (draft.schema ? "/" + String(draft.schema).trim() : "");
  }

  function maskConnectionEndpoint(draft) {
    if (draft.sourceKind === "database") {
      const host = String(draft.host || "").trim();
      const maskedHost = /^[0-9.]+$/.test(host) ? host.split(".").map((part, indexValue, items) => indexValue === 0 || indexValue === items.length - 1 ? part : "***").join(".") : (host.slice(0, 2) || "**") + "***";
      return maskedHost + ":" + String(draft.port || "") + "/" + (String(draft.database || "").slice(0, 2) || "**") + "***";
    }
    try {
      const url = new URL(String(draft.endpoint || ""));
      const parts = url.hostname.split(".");
      const maskedHost = (parts[0]?.slice(0, 2) || "**") + "***" + (parts.length > 1 ? "." + parts.slice(-1)[0] : "");
      return url.protocol + "//" + maskedHost + "/***";
    } catch (_) { return "已脱敏平台地址"; }
  }

  function connectionSignature(draft) {
    return stableHash([draft.sourceKind, draft.name, draft.businessType, draft.connectorType, connectionEndpoint(draft)].map(value => String(value || "").trim().toLowerCase()).join("|"));
  }


  function connectionTestSignature(draft) {
    return stableHash([connectionSignature(draft), draft.matchKey, draft.username, draft.schema, draft.authType, draft.appId, draft.secret].map(value => String(value || "").trim()).join("|"));
  }
  function connectionValidationErrors(draft, includeSecret = true) {
    const errors = [];
    if (!String(draft.name || "").trim()) errors.push("请输入接入名称");
    if (!CONNECTION_BUSINESS[draft.businessType]) errors.push("请选择业务类型");
    if (!CONNECTION_MATCH_KEYS[draft.matchKey]) errors.push("请选择身份匹配主键");
    if (draft.sourceKind === "database") {
      if (!["MySQL", "PostgreSQL", "SQL Server"].includes(draft.connectorType)) errors.push("请选择数据库类型");
      if (!String(draft.host || "").trim() || /\s/.test(String(draft.host || ""))) errors.push("请输入有效主机地址");
      const port = Number(draft.port); if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("端口必须为1至65535");
      if (!String(draft.database || "").trim()) errors.push("请输入数据库名称");
      if (!String(draft.username || "").trim()) errors.push("请输入用户名");
      if (includeSecret && !String(draft.secret || "")) errors.push("请输入密码");
    } else {
      if (!["REST API", "SFTP", "Webhook"].includes(draft.connectorType)) errors.push("请选择平台协议");
      const endpoint = String(draft.endpoint || "").trim();
      try { const parsed = new URL(endpoint); const validProtocol = draft.connectorType === "SFTP" ? parsed.protocol === "sftp:" : ["http:", "https:"].includes(parsed.protocol); if (!validProtocol) errors.push("服务地址协议与接入方式不匹配"); } catch (_) { errors.push("请输入有效服务地址"); }
      if (!String(draft.appId || "").trim()) errors.push("请输入App ID");
      if (includeSecret && !String(draft.secret || "")) errors.push("请输入Token");
    }
    const signature = connectionSignature(draft);
    if (petState?.connections?.some(item => item.id === "external-" + signature || item.fingerprint === signature)) errors.push("该数据源已接入");
    if ((petState?.connections?.length || 0) >= CONNECTION_MAX) errors.push("外接平台已达到5个上限");
    return [...new Set(errors)];
  }

  function connectionPreview(draft) {
    const signature = connectionSignature(draft), business = CONNECTION_BUSINESS[draft.businessType] || CONNECTION_BUSINESS.other;
    const categories = business.categories.map((label, indexValue) => ({ label, count: 1 + parseInt(stableHash(signature + ":" + indexValue).slice(0, 2), 16) % 3 }));
    const confidence = Number((.78 + parseInt(signature.slice(0, 2), 16) % 13 / 100).toFixed(2));
    const minute = String(parseInt(signature.slice(-2), 16) % 60).padStart(2, "0");
    return { signature, categories, recordCount: categories.reduce((sum, item) => sum + item.count, 0), dataVersion: "EXT-" + signature.slice(0, 6).toUpperCase() + "-v1", syncedAt: "2026-08-16 09:" + minute + ":00", matchMethod: CONNECTION_MATCH_KEYS[draft.matchKey], confidence };
  }

  function dataConnectionFingerprint() {
    const source = petState.connections.slice().sort((a, b) => a.id.localeCompare(b.id)).map(item => [item.id, item.fingerprint, item.dataVersion, item.categories.map(categoryItem => categoryItem.label + ":" + categoryItem.count).join(",")].join("|")).join(";");
    return stableHash(source || "built-in-platforms-only");
  }

  function persistDataConnections() { writeStore(STORE.petConnections, petState.connections); }

  function connectionFromDraft(draft, preview) {
    return {
      id: "external-" + preview.signature, sourceKind: draft.sourceKind, name: String(draft.name).trim(), businessType: draft.businessType, connectorType: draft.connectorType,
      endpointMasked: maskConnectionEndpoint(draft), status: "CONNECTED", matchKey: draft.matchKey, matchMethod: preview.matchMethod, confidence: preview.confidence,
      categories: preview.categories, dataVersion: preview.dataVersion, syncedAt: preview.syncedAt, fingerprint: stableHash(preview.signature + ":" + preview.dataVersion + ":" + preview.recordCount), connectedAt: preview.syncedAt,
    };
  }

  function connectionToOntologyPlatform(connection, claim) {
    const business = CONNECTION_BUSINESS[connection.businessType] || CONNECTION_BUSINESS.other;
    const categories = connection.categories.map((categoryItem, categoryIndex) => {
      const categoryId = connection.id + "-category-" + categoryIndex;
      const records = Array.from({ length: categoryItem.count }, (_, recordIndex) => {
        const recordId = categoryId + "-record-" + (recordIndex + 1), recordHash = stableHash(recordId + ":" + claim.id);
        return { id: recordId, level: "record", nodeType: "具体记录", label: categoryItem.label + (categoryItem.count > 1 ? " " + (recordIndex + 1) : ""), localId: "REC-****" + recordHash.slice(-3), eventTime: claim.admissionDate, summary: connection.name + " · " + categoryItem.label + " · " + connection.dataVersion, relationLabel: "包含记录", matchMethod: "接入字段映射", confidence: connection.confidence, relationStatus: "NEEDS_VERIFICATION", evidence: connection.name + "数据摘要", effectivePeriod: connection.syncedAt + " 起" };
      });
      return { id: categoryId, level: "category", nodeType: "数据类别", label: categoryItem.label, localId: records.length + " 条记录", records, relationLabel: "包含类别", matchMethod: "接入数据字典映射", confidence: connection.confidence, relationStatus: "NEEDS_VERIFICATION", evidence: connection.name + "字段目录", effectivePeriod: connection.syncedAt + " 起" };
    });
    return { id: connection.id, level: "platform", nodeType: "数据平台", label: connection.name, platformType: business.platformType, kind: business.kind, localId: "EXT-****" + connection.id.slice(-3), matchMethod: connection.matchMethod, confidence: connection.confidence, relationStatus: "NEEDS_VERIFICATION", evidence: connection.name + " · " + connection.endpointMasked + " · " + connection.dataVersion, effectivePeriod: connection.syncedAt + " 起", summary: connection.dataVersion + " · " + connection.endpointMasked, dataVersion: connection.dataVersion, external: true, categories };
  }
  function icon(name, size = 19) {
    const paths = {
      chart: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>', database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M7 12h10"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
      nodes: '<circle cx="5" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8 11 7-4m-7 6 7 4"/>', sliders: '<path d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h7m4 0h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
      files: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5m-5 4h5"/>', check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>', download: '<path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/>', arrow: '<path d="m9 18 6-6-6-6"/>', bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', upload: '<path d="M12 16V4m-4 4 4-4 4 4M5 20h14"/>',
      shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-5"/>', refresh: '<path d="M20 6v5h-5M4 18v-5h5M6.2 8a7 7 0 0 1 11-2l2.8 5M4 13l2.8 5a7 7 0 0 0 11-2"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06-2.76 2.76-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21H10v-.09A1.8 1.8 0 0 0 8.9 19.3a1.8 1.8 0 0 0-2 .36l-.06.06-2.76-2.76.06-.06a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.85 14H2v-4h.85A1.8 1.8 0 0 0 4.5 8.9a1.8 1.8 0 0 0-.36-2l-.06-.06 2.76-2.76.06.06a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 10 2.85V2h4v.85a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.06-.06 2.76 2.76-.06.06a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 21.15 10H22v4h-.85A1.8 1.8 0 0 0 19.4 15z"/>',
    };
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.files}</svg>`;
  }

  function generatePetClaims(count) {
    const random = seededRandom(SNAPSHOT.seed), names = ["团子", "栗子", "可乐", "糯米", "布丁", "雪饼", "豆包", "年糕", "奶盖", "旺财"], hospitals = ["安和宠物医院", "星云动物诊疗中心", "伴伴宠物医院", "嘉禾动物医院"], other = [["DERMATITIS", "过敏性皮炎"], ["URINARY_INFECTION", "泌尿系统感染"], ["RESPIRATORY_INFECTION", "呼吸道感染"]], boundary = [199, 200, 200.01, 499.99, 500, 500.01];
    return Array.from({ length: count }, (_, i) => {
      const isBoundary = i < boundary.length, region = isBoundary ? "上海" : random() < .64 ? "上海" : ["杭州", "苏州", "南京"][Math.floor(random() * 3)], gastro = isBoundary || random() < .58, disease = gastro ? ["GASTROENTERITIS", "急性肠胃炎"] : other[Math.floor(random() * other.length)], coveredExpense = isBoundary ? boundary[i] : Number((45 + random() * 850).toFixed(2)), materialComplete = i === 12 ? null : i === 8 ? false : random() > .055, ocrConfidence = i === 9 ? .61 : Number((.78 + random() * .21).toFixed(2)), imageCompliance = i === 13 ? null : i === 10 ? "FAIL" : i === 11 ? "NEEDS_REVIEW" : random() < .08 ? "NEEDS_REVIEW" : "PASS", a = Number((coveredExpense * (.42 + random() * .16)).toFixed(2)), b = Number((coveredExpense * (.2 + random() * .12)).toFixed(2)), c = Number(Math.max(0, coveredExpense - a - b).toFixed(2));
      return { id: `CLM-SH-2026${String(i + 1).padStart(4, "0")}`, policyId: `POL-PET-${String(i % 236 + 1).padStart(5, "0")}`, petId: `PET-${String(i % 217 + 1).padStart(5, "0")}`, ownerId: `OWN-${String(i % 181 + 1).padStart(4, "0")}`, petName: `${names[i % names.length]}${i > 9 ? Math.floor(i / 10) + 1 : ""}`, species: random() < .68 ? "犬" : "猫", breed: random() < .68 ? "柯基" : "英国短毛猫", region, hospital: hospitals[Math.floor(random() * hospitals.length)], diseaseCode: disease[0], disease: disease[1], claimAmount: Number((coveredExpense + 35 + random() * 260).toFixed(2)), coveredExpense, lineItems: [{ name: "诊查与检查费", amount: a, eligible: true }, { name: "处置治疗费", amount: b, eligible: true }, { name: "处方药品费", amount: c, eligible: true }], deductible: 100, reimbursementRate: .8, remainingLimit: Math.round(1800 + random() * 8200), materialComplete, ocrConfidence, imageCompliance, duplicateSimilarity: Math.round(35 + random() * 63), familyDiseaseCount: random() < .78 ? 0 : Math.floor(1 + random() * 4), accountClaimCount: random() < .82 ? 1 : Math.floor(2 + random() * 4), admissionDate: `2026-0${i % 6 + 1}-${String(i % 24 + 3).padStart(2, "0")}` };
    });
  }

  function evidenceFor(claim) {
    const builtIn = [
      { id: "record", type: "病历扫描件", file: "medical-record.svg", confidence: claim.ocrConfidence, result: "诊断：急性肠胃炎；主诉：呕吐、腹泻2日", fact: "Disease/GASTROENTERITIS" },
      { id: "invoice", type: "费用发票", file: "invoice.svg", confidence: Math.max(.7, claim.ocrConfidence - .02), result: `合计 ${money(claim.claimAmount, 2)}；可覆盖费用 ${money(claim.coveredExpense, 2)}`, fact: "Claim.coveredExpense" },
      { id: "lab", type: "检验报告", file: "lab-report.svg", confidence: .93, result: "白细胞轻度升高；炎症指标阳性", fact: "Evidence/LAB_REPORT" },
      { id: "image", type: "诊疗图片", file: "xray.svg", confidence: .86, result: "图像质量可审核；未输出医疗诊断", fact: "ImageReviewResult" },
      { id: "statement", type: "用户病述", file: "pet-statement.svg", confidence: .91, result: "近两日食欲下降并伴随呕吐", fact: "Symptom/VOMITING" },
    ];
    return [...builtIn, ...petState.sessionUploads.filter(item => item.claimId === claim.id)];
  }

  function decide(claim, strategy) {
    const inScope = claim.region === strategy.region && claim.diseaseCode === strategy.diseaseCode, threshold = strategy.threshold ?? strategy.coveredExpenseThreshold, notCovered = inScope && claim.coveredExpense > threshold, coverageRecommendation = notCovered ? "NOT_COVERED_RECOMMENDATION" : "COVERED_RECOMMENDATION";
    let processingRoute = "AUTO_REVIEW"; const signals = [];
    if (!claim.materialComplete) { processingRoute = "REQUEST_MORE"; signals.push("EVIDENCE_INCOMPLETE"); }
    else { if (claim.imageCompliance !== "PASS") signals.push(`IMAGE_${claim.imageCompliance}`); if (claim.ocrConfidence < .75) signals.push("OCR_LOW_CONFIDENCE"); if (claim.duplicateSimilarity >= 94) signals.push("DUPLICATE_EVIDENCE"); if (claim.familyDiseaseCount >= 3) signals.push("FAMILY_CLUSTER_LEAD"); if (claim.accountClaimCount >= 4) signals.push("LINKED_ACCOUNT_LEAD"); if (signals.length) processingRoute = "MANUAL_REVIEW"; }
    const payableAmount = notCovered ? 0 : Number(Math.min(claim.remainingLimit, Math.max(0, claim.coveredExpense - claim.deductible) * claim.reimbursementRate).toFixed(2));
    return { coverageRecommendation, processingRoute, payableAmount, inScope, signals, ruleHit: notCovered ? "GI-COVERED-EXPENSE-THRESHOLD" : inScope ? "GI-WITHIN-THRESHOLD" : "OUT_OF_EXPERIMENT_SCOPE", explanation: !inScope ? "案件不属于上海肠胃炎实验范围，阈值规则不适用。" : notCovered ? `可覆盖费用 ${money(claim.coveredExpense, 2)} 严格大于 ${money(threshold)}，输出不覆盖建议。` : `可覆盖费用 ${money(claim.coveredExpense, 2)} 未严格大于 ${money(threshold)}，输出覆盖建议。`, branch: notCovered ? "THEN" : "ELSE", conditionTrace: [] };
  }

  function claimConditionValue(claim, field) {
    const meta = RULE_FIELDS[field];
    if (!meta) return undefined;
    const value = claim[meta.property];
    return field === "reimbursement_rate" && value != null ? Number((Number(value) * 100).toFixed(4)) : value;
  }
  function compareRuleValue(actual, operator, expected) {
    if (operator === "IN" || operator === "NOT_IN") {
      const expectedValues = Array.isArray(expected) ? expected.map(String) : String(expected).split(",").map(item => item.trim()).filter(Boolean);
      const included = expectedValues.includes(String(actual));
      return operator === "IN" ? included : !included;
    }
    if (operator === ">") return Number(actual) > Number(expected);
    if (operator === ">=") return Number(actual) >= Number(expected);
    if (operator === "<") return Number(actual) < Number(expected);
    if (operator === "<=") return Number(actual) <= Number(expected);
    if (operator === "!=") return String(actual) !== String(expected);
    return String(actual) === String(expected);
  }
  function evaluateRuleCondition(claim, condition) {
    const actual = claimConditionValue(claim, condition.field), missing = actual == null || actual === "", matched = !missing && compareRuleValue(actual, condition.operator, condition.value);
    return { id: condition.id, field: condition.field, label: RULE_FIELDS[condition.field]?.label || condition.field, operator: condition.operator, expected: condition.value, actual, missing, matched };
  }
  function decideCandidateRule(claim, rule) {
    const baseline = decide(claim, BASELINE), scopeMatches = (rule.scope.region === "ALL" || claim.region === rule.scope.region) && (rule.scope.diseaseCode === "ALL" || claim.diseaseCode === rule.scope.diseaseCode);
    if (!scopeMatches) return { ...baseline, inScope: false, branch: "OUT_OF_SCOPE", ruleHit: "CANDIDATE_OUT_OF_SCOPE", conditionTrace: [], explanation: "案件不在候选策略适用范围内，沿用现行策略。" };
    const conditionTrace = rule.conditions.map(condition => evaluateRuleCondition(claim, condition)), hasMissing = conditionTrace.some(item => item.missing);
    if (hasMissing && rule.onMissing === "REQUEST_MORE") return { ...baseline, processingRoute: "REQUEST_MORE", inScope: true, branch: "MISSING", conditionTrace, ruleHit: "CANDIDATE_MISSING_REQUEST_MORE", signals: [...new Set([...baseline.signals, "CANDIDATE_FACT_MISSING"])], explanation: "候选规则引用字段存在空值，保障建议沿用现行并进入补件路由。" };
    const normalizedResults = conditionTrace.map(item => item.missing ? false : item.matched), matched = rule.logic === "OR" ? normalizedResults.some(Boolean) : normalizedResults.every(Boolean), branch = matched ? "THEN" : "ELSE", actions = matched ? rule.thenActions : rule.elseActions;
    const coverageRecommendation = actions.coverageRecommendation === "INHERIT_BASELINE" ? baseline.coverageRecommendation : actions.coverageRecommendation;
    const processingRoute = actions.processingRoute === "INHERIT_BASELINE" ? baseline.processingRoute : actions.processingRoute;
    const payableAmount = coverageRecommendation === "NOT_COVERED_RECOMMENDATION" ? 0 : Number(Math.min(claim.remainingLimit, Math.max(0, claim.coveredExpense - claim.deductible) * claim.reimbursementRate).toFixed(2));
    const changedDimensions = [coverageRecommendation !== baseline.coverageRecommendation ? "保障建议" : "", processingRoute !== baseline.processingRoute ? "处理路由" : ""].filter(Boolean);
    return {
      coverageRecommendation, processingRoute, payableAmount, inScope: true, branch, conditionTrace,
      signals: [...new Set([...baseline.signals, `CANDIDATE_${branch}`])],
      ruleHit: `CANDIDATE_${branch}_${candidateRuleHash(rule).toUpperCase()}`,
      explanation: `候选条件组${matched ? "命中" : "未命中"}，执行 ${branch} 分支${changedDimensions.length ? "，更新" + changedDimensions.join("与") : "并沿用现行决策"}。`,
    };
  }

  function calculatePetSimulation(ruleInput, timestamp = new Date().toISOString()) {
    const candidate = typeof ruleInput === "number" ? defaultCandidateRule(ruleInput) : sanitizeCandidateRule(ruleInput, 500), ruleHash = candidateRuleHash(candidate), threshold = candidateThreshold(candidate);
    const rows = petClaims.map(claim => {
      const oldDecision = decide(claim, BASELINE), newDecision = decideCandidateRule(claim, candidate);
      const changed = oldDecision.coverageRecommendation !== newDecision.coverageRecommendation || oldDecision.processingRoute !== newDecision.processingRoute || oldDecision.payableAmount !== newDecision.payableAmount;
      return { ...claim, oldDecision, newDecision, changed, impactGroup: changed };
    });
    const summarize = key => {
      const summary = { covered: 0, notCovered: 0, auto: 0, manual: 0, requestMore: 0, payable: 0, workHours: 0 };
      rows.forEach(row => {
        const decision = row[key];
        decision.coverageRecommendation === "COVERED_RECOMMENDATION" ? summary.covered++ : summary.notCovered++;
        decision.processingRoute === "AUTO_REVIEW" ? summary.auto++ : decision.processingRoute === "MANUAL_REVIEW" ? summary.manual++ : summary.requestMore++;
        summary.payable += decision.payableAmount;
      });
      summary.payable = Number(summary.payable.toFixed(2)); summary.workHours = Number((summary.manual * .45 + summary.requestMore * .15).toFixed(1));
      return summary;
    };
    const oldSummary = summarize("oldDecision"), newSummary = summarize("newDecision"), changedRows = rows.filter(row => row.changed), distribution = Array.from({ length: 16 }, (_, indexValue) => ({ from: indexValue * 50, to: (indexValue + 1) * 50, count: 0 }));
    rows.filter(row => row.region === "上海" && row.diseaseCode === "GASTROENTERITIS").forEach(row => distribution[Math.min(15, Math.floor(row.coveredExpense / 50))].count++);
    const conditionStats = candidate.conditions.map(condition => {
      const traces = rows.filter(row => row.newDecision.inScope).map(row => row.newDecision.conditionTrace.find(trace => trace.id === condition.id)).filter(Boolean);
      return { id: condition.id, label: conditionLabel(condition), matched: traces.filter(trace => trace.matched).length, missing: traces.filter(trace => trace.missing).length, total: traces.length };
    });
    return {
      id: `SIM-${SNAPSHOT.seed}-${stableHash(ruleHash + ":" + snapshotHash())}`, timestamp, threshold, isThresholdExperiment: isStandardThresholdRule(candidate), ruleHash, candidate,
      rows, oldSummary, newSummary, changedRows, impactCount: changedRows.length, conditionStats, distribution,
      coverageChangedCount: rows.filter(row => row.oldDecision.coverageRecommendation !== row.newDecision.coverageRecommendation).length,
      routeChangedCount: rows.filter(row => row.oldDecision.processingRoute !== row.newDecision.processingRoute).length,
      payoutDelta: Number((newSummary.payable - oldSummary.payable).toFixed(2)), coveredDelta: newSummary.covered - oldSummary.covered,
      workHoursDelta: Number((newSummary.workHours - oldSummary.workHours).toFixed(1)), estimatedWorkCostDelta: Math.round((newSummary.workHours - oldSummary.workHours) * 120),
    };
  }
  function generateCreditApplicants(count) { const random = seededRandom(20260811); return Array.from({ length: count }, (_, i) => ({ id: `APP2025${String(i + 1).padStart(5, "0")}`, creditScore: Math.round(470 + random() * 300), overdueCount: random() < .7 ? 0 : Math.floor(1 + random() * 5), maxOverdueDays: Math.round(random() * 130), dti: Number((25 + random() * 75).toFixed(1)), amount: Math.round((5000 + random() * 95000) / 1000) * 1000 })); }
  function creditDecision(row, rules) { if (row.overdueCount >= rules.overdueCount || row.maxOverdueDays > rules.maxOverdueDays) return "REJECT"; if (row.dti > rules.dtiPercent || row.creditScore < 560) return "REVIEW"; return "PASS"; }
  function calculateCreditSimulation(rules) { const rows = creditApplicants.map(row => ({ ...row, oldDecision: creditDecision(row, CREDIT_BASE), newDecision: creditDecision(row, rules) })), count = (key, value) => rows.filter(row => row[key] === value).length; return { rows, old: { PASS: count("oldDecision", "PASS"), REVIEW: count("oldDecision", "REVIEW"), REJECT: count("oldDecision", "REJECT") }, next: { PASS: count("newDecision", "PASS"), REVIEW: count("newDecision", "REVIEW"), REJECT: count("newDecision", "REJECT") }, changed: rows.filter(row => row.oldDecision !== row.newDecision).length }; }

  function getRoute() {
    const active = readStore(STORE.solution, "pet");
    const raw = location.hash.slice(1) || (active === "credit" ? "/credit/datasets" : "/pet/intake");
    const [rawPath, query = ""] = raw.split("?"), redirectedReview = rawPath === "/pet/review", params = new URLSearchParams(query);
    if (redirectedReview && !params.has("evidence")) params.set("evidence", "image");
    const path = legacy[rawPath] || rawPath;
    const valid = path === "/settings" || [...petNav, ...creditNav].some(item => item[0] === path);
    const safe = valid ? path : "/pet/intake";
    const solution = safe === "/settings" ? active : safe.startsWith("/credit/") ? "credit" : "pet";
    return { path: safe, solution, query: params, redirectHash: redirectedReview ? `#/pet/intake?${params.toString()}` : "" };
  }
  function syncRoute(route) { const id = route.query.get("claim"); if (id && petClaims.some(item => item.id === id)) petState.selectedClaimId = id; const evidenceId = route.query.get("evidence"); if (evidenceId) petState.selectedEvidenceId = evidenceId; const transition = route.query.get("transition"); if (transition) petState.filters.transition = transition; }
  function render() {
    const route = getRoute();
    if (route.redirectHash) history.replaceState(null, "", `${location.pathname}${location.search}${route.redirectHash}`);
    if (route.path !== "/settings") writeStore(STORE.solution, route.solution);
    syncRoute(route);
    const view = route.path === "/settings" ? renderSettings(route) : route.solution === "pet" ? renderPetPage(route) : renderCreditPage(route);
    app.innerHTML = `<div class="app-shell">${renderSidebar(route)}<section class="app-stage">${renderTopbar(route)}<div class="workspace ${view.aside ? "has-aside" : ""} ${route.solution === "pet" ? "pet-workspace" : ""} ${route.path === "/settings" ? "settings-workspace" : ""}"><main class="main-content ${route.solution === "pet" ? "pet-page" : ""}" id="main-content">${view.main}</main>${view.aside ? `<aside class="context-panel" aria-label="页面信息与操作">${view.aside}</aside>` : ""}</div></section></div>`;
  }
  function renderSidebar(route) {
    const items = route.solution === "pet" ? petNav : creditNav;
    return `<aside class="sidebar" aria-label="主导航"><a class="brand-mark" href="#${route.solution === "pet" ? "/pet/intake" : "/credit/datasets"}" aria-label="Strategy Sandbox 首页"><span>S</span></a><nav class="side-nav">${items.map(([path, label, glyph]) => `<a class="nav-link ${route.path === path ? "active" : ""}" href="#${path}" aria-label="${label}" data-tooltip="${label}" ${route.path === path ? 'aria-current="page"' : ""}>${icon(glyph)}</a>`).join("")}</nav><div class="side-bottom"><a class="nav-link ${route.path === "/settings" ? "active" : ""}" href="#/settings" aria-label="模型设置" data-tooltip="模型设置" ${route.path === "/settings" ? 'aria-current="page"' : ""}>${icon("settings")}</a><button class="icon-button" aria-label="通知" data-tooltip="通知">${icon("bell")}</button><div class="avatar" data-tooltip="演示用户">J</div></div></aside>`;
  }
  function snapshotId() { return petState.workflow.snapshotFrozen ? (petState.backendSnapshot?.id || SNAPSHOT.id) : "FS-PET-GI-SH-2026Q2-DRAFT"; }
  function snapshotHash() { return petState.backendSnapshot?.hash || petState.workflow.snapshotHash || "待冻结后生成"; }
  function snapshotFrozenAt() { return petState.backendSnapshot?.frozenAt ? new Date(petState.backendSnapshot.frozenAt).toLocaleString("zh-CN", { hour12: false }) : petState.workflow.snapshotFrozenAt || "未冻结"; }
  function renderTopbar(route) { const pet = route.solution === "pet"; return `<header class="topbar"><div class="product-switcher"><span class="eyebrow">Strategy Sandbox</span><select aria-label="选择解决方案" data-input="solution-switch"><option value="pet" ${pet ? "selected" : ""}>宠物险理赔</option><option value="credit" ${!pet ? "selected" : ""}>信贷准入</option></select></div><form class="global-search" data-form="global-search" role="search">${icon("search", 18)}<input name="q" autocomplete="off" placeholder="搜索案件、保单、宠物或策略版本" aria-label="全局搜索"><kbd>⌘ K</kbd></form><div class="topbar-context">${pet ? `<span class="experiment-chip"><i></i>${isStandardThresholdRule(petState.candidateRule) ? "上海肠胃炎阈值实验" : "宠物险候选规则实验"}</span><span class="snapshot-chip">${petState.workflow.snapshotFrozen ? snapshotId() : "FactSnapshot 草稿"}</span>` : '<span class="experiment-chip"><i></i>消费贷准入实验</span>'}<span class="offline-chip">离线沙箱</span></div></header>`; }

  function pageHeader(kicker, title, description, actions = "") { return `<header class="page-header"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`; }
  function petPageHeader(title, actions = "") { return '<header class="pet-page-title glass-panel"><h1>' + title + '</h1>' + (actions ? '<div class="pet-page-title-actions">' + actions + '</div>' : '') + '</header>'; }
  function dataConnectionHeaderAction() { return petState.workflow.ontologyBuilt ? button("数据接入", "open-data-connection", { primary: true, iconName: "database" }) : ""; }
  function button(label, action, opts = {}) { return `<button class="button ${opts.primary ? "primary" : ""}" type="button" data-action="${action}" ${opts.disabled ? "disabled" : ""}>${opts.iconName ? icon(opts.iconName, 17) : ""}<span>${label}</span></button>`; }
  function maturity(key) { const item = MATURITY[key]; return `<span class="maturity ${item[1]}"><i></i>${item[0]}</span>`; }
  function recommendation(code) { return code === "COVERED_RECOMMENDATION" ? '<span class="status success"><i></i>覆盖建议</span>' : '<span class="status orange"><i></i>不覆盖建议</span>'; }
  function routeBadge(code) { const map = { AUTO_REVIEW: ["自动审核", "blue"], MANUAL_REVIEW: ["人工复核", "purple"], REQUEST_MORE: ["待补材料", "orange"] }, item = map[code] || [code, ""]; return `<span class="status ${item[1]}"><i></i>${item[0]}</span>`; }
  function kv(label, value) { return `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`; }
  function contextTitle(title, description) { return `<div class="context-title"><span class="eyebrow">CONTEXT</span><h2>${title}</h2><p>${description}</p></div>`; }
  function kpi(label, value, detail, mat, kind) { return `<button class="kpi-card" data-action="kpi-drill" data-kind="${kind}"><span class="kpi-top"><span>${label}</span>${maturity(mat)}</span><strong>${value}</strong><span class="kpi-detail">${detail}</span><span class="kpi-arrow">${icon("arrow", 16)}</span></button>`; }
  function persistWorkflow() { /* v20宠物险业务状态统一由FastAPI持久化 */ }
  function workflowStatus(imageContext = false) { const w = petState.workflow, items = [[imageContext ? "文本材料已核对" : "材料登记与OCR", w.materialsRegistered && w.ocrValidated], ["诊疗图片人工审核", w.imageReviewComplete], ["本体关系人工确认", w.ontologyConfirmed], ["FactSnapshot冻结", w.snapshotFrozen], ["候选策略保存", w.candidateSaved], ["规则检查", w.validationPassed]], done = items.filter(([, value]) => value).length, pending = items.filter(([, value]) => !value); return `<div class="aside-group workflow-status"><span class="aside-label">处理状态</span><div class="workflow-summary ${done === items.length ? "complete" : ""}"><i>${done === items.length ? "✓" : `${done}/${items.length}`}</i><span><strong>${done === items.length ? "处理链已就绪" : "仍有前置任务"}</strong><small>${done}/${items.length} 已完成</small></span></div>${pending.slice(0, 2).map(([label]) => `<div class="workflow-pending"><i>·</i><span>${label}</span></div>`).join("")}${pending.length > 2 ? `<small class="workflow-more">另有 ${pending.length - 2} 项待处理</small>` : ""}</div>`; }
  async function apiRequest(path, options = {}) {
    let response;
    try {
      const headers = { ...(options.headers || {}) };
      if (!(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      response = await fetch(path, { ...options, headers });
    } catch (_) {
      throw new Error("无法连接本地FastAPI服务，请使用 npm start 启动平台");
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) { const error = new Error(payload?.error?.message || "服务暂时不可用，请稍后重试"); error.code = payload?.error?.code; error.details = payload?.error?.details; throw error; }
    return payload;
  }
  function normalizeBackendRun(run) {
    if (!run) return null;
    const rows = Array.isArray(run.rows) ? run.rows.map(item => ({ ...item.claim, ...item, oldDecision: item.oldDecision || item.old, newDecision: item.newDecision || item.new, impactGroup: Boolean(item.changed) })) : [];
    const oldSummary = { ...(run.metrics?.oldSummary || run.oldSummary || {}) }, newSummary = { ...(run.metrics?.newSummary || run.newSummary || {}) };
    oldSummary.workHours = Number((Number(oldSummary.manual || 0) * .45 + Number(oldSummary.requestMore || 0) * .15).toFixed(1));
    newSummary.workHours = Number((Number(newSummary.manual || 0) * .45 + Number(newSummary.requestMore || 0) * .15).toFixed(1));
    const candidate = petState.candidateRule, changedRows = rows.filter(item => item.changed);
    const conditionStats = (candidate.conditions || []).map(condition => {
      const traces = rows.map(row => row.newDecision?.conditionTrace?.find(trace => (trace.conditionId || trace.id) === condition.id)).filter(Boolean);
      return { id: condition.id, label: conditionLabel(condition), matched: traces.filter(item => item.matched).length, missing: traces.filter(item => item.missing).length, total: traces.length };
    });
    return {
      ...run, id: run.id || run.runId, candidate, rows, changedRows, impactCount: changedRows.length, oldSummary, newSummary, conditionStats,
      threshold: candidateThreshold(candidate), isThresholdExperiment: isStandardThresholdRule(candidate),
      coverageChangedCount: rows.filter(row => row.oldDecision?.coverageRecommendation !== row.newDecision?.coverageRecommendation).length,
      routeChangedCount: rows.filter(row => row.oldDecision?.processingRoute !== row.newDecision?.processingRoute).length,
      payoutDelta: Number(run.metrics?.payableDelta ?? run.payableDelta ?? 0), coveredDelta: Number(run.metrics?.coverageRecommendationDelta ?? 0),
      workHoursDelta: Number(run.metrics?.workHoursDelta ?? 0), estimatedWorkCostDelta: Math.round(Number(run.metrics?.workHoursDelta || 0) * 120),
      distribution: run.distribution || [], ruleHash: run.ruleHash || "",
    };
  }
  function hydrateBackendState(data) {
    if (!data) return;
    petState.backendReady = true;
    petState.experimentRevision = Number(data.experiment?.revision || 0);
    petState.backendSnapshot = data.snapshot || null;
    petState.backendValidation = data.validation || null;
    petState.activeStrategyId = data.candidateRule?.strategyId || null;
    petClaims.splice(0, petClaims.length, ...(data.claims || []));
    petState.workflow = { ...DEFAULT_WORKFLOW, ...(data.workflow || {}), snapshotHash: data.snapshot?.hash || null, snapshotFrozenAt: data.snapshot?.frozenAt || null };
    petState.selectedClaimId = petClaims.some(item => item.id === petState.selectedClaimId) ? petState.selectedClaimId : (data.activeClaimId || petClaims[0]?.id);
    petState.connections = Array.isArray(data.connections) ? data.connections.map(connection => ({ ...connection, categories: (connection.categories || []).map(item => ({ label: item.label || item.name, count: Number(item.count ?? item.recordCount ?? 0) })) })) : [];
    petState.candidateRule = sanitizeCandidateRule(data.candidateRule || defaultCandidateRule(500), 500);
    petState.ruleDraft = cloneRule(petState.candidateRule);
    petState.ruleSource = petState.candidateRule.sourceText || petState.ruleSource;
    const mappedReviews = {};
    Object.values(data.reviews || {}).forEach(review => {
      const match = String(review.evidenceId || "").match(/^EV-(\d{4})-diagnostic_image$/);
      const claim = match ? petClaims[Number(match[1]) - 1] : null;
      if (claim) mappedReviews[`${claim.id}:image`] = { ...review, reviewedAt: review.createdAt };
    });
    petState.reviews = mappedReviews;
    petState.run = normalizeBackendRun(data.run);
  }
  async function loadBackendState(renderAfter = true) {
    try {
      const payload = await apiRequest("/api/app-state", { method: "GET" });
      hydrateBackendState(payload.data);
    } catch (error) {
      petState.backendReady = false;
      toast(error.message);
    }
    if (renderAfter) render();
  }
  function updateModelSettings(settings) {
    petState.modelSettings = { ...petState.modelSettings, ...settings, loading: false };
    petState.modelSettingsDraft = {
      baseUrl: settings.baseUrl || petState.modelSettingsDraft.baseUrl,
      model: settings.model || petState.modelSettingsDraft.model,
      apiKey: "",
      timeoutMs: Number(settings.timeoutMs || 30000),
    };
  }
  async function loadModelSettings(renderAfter = true) {
    try {
      const payload = await apiRequest("/api/model/settings", { method: "GET" });
      updateModelSettings(payload.settings || {});
      petState.modelSettingsError = "";
    } catch (error) {
      petState.modelSettings = { ...petState.modelSettings, loading: false, configured: false, source: "NONE" };
      petState.modelSettingsError = error.message;
    }
    if (renderAfter) render();
  }
  function modelSettingsPayload() {
    return {
      baseUrl: String(petState.modelSettingsDraft.baseUrl || "").trim(),
      model: String(petState.modelSettingsDraft.model || "").trim(),
      apiKey: String(petState.modelSettingsDraft.apiKey || ""),
      timeoutMs: Number(petState.modelSettingsDraft.timeoutMs || 30000),
    };
  }
  async function saveModelSettings(returnAfter = false) {
    petState.modelSettingsBusy = true; petState.modelSettingsError = ""; render();
    try {
      const payload = await apiRequest("/api/model/settings", { method: "PUT", body: JSON.stringify(modelSettingsPayload()) });
      updateModelSettings(payload.settings || {});
      petState.modelSettingsBusy = false;
      if (returnAfter) location.hash = "#" + petState.settingsReturnPath;
      else { render(); toast("模型配置已保存到服务端内存"); }
    } catch (error) {
      petState.modelSettingsBusy = false; petState.modelSettingsError = error.message; render();
    }
  }
  async function testModelSettings() {
    petState.modelSettingsBusy = true; petState.modelSettingsError = ""; render();
    try {
      const payload = await apiRequest("/api/model/test", { method: "POST", body: JSON.stringify(modelSettingsPayload()) });
      petState.modelSettingsBusy = false;
      petState.modelSettings = { ...petState.modelSettings, lastTest: { ok: true, testedAt: payload.testedAt, latencyMs: payload.latencyMs } };
      render(); toast("连接成功，模型可以使用");
    } catch (error) {
      petState.modelSettingsBusy = false; petState.modelSettingsError = error.message; render();
    }
  }
  async function clearModelSettings() {
    petState.modelSettingsBusy = true; petState.modelSettingsError = ""; render();
    try {
      const payload = await apiRequest("/api/model/settings", { method: "DELETE" });
      updateModelSettings(payload.settings || {});
      petState.modelSettingsBusy = false; render(); toast("进程内模型配置已清除");
    } catch (error) {
      petState.modelSettingsBusy = false; petState.modelSettingsError = error.message; render();
    }
  }
  function renderSettings(route) {
    const requested = route.query.get("return");
    if (requested && /^\/(pet|credit)\//.test(requested)) petState.settingsReturnPath = requested;
    const settings = petState.modelSettings, draft = petState.modelSettingsDraft, busy = petState.modelSettingsBusy;
    const status = settings.loading ? "正在读取" : settings.configured ? "已配置" : "未配置";
    const main = `${petPageHeader("模型设置")}
      <div class="model-settings-page">
        <section class="glass-panel model-settings-card">
          <div class="settings-card-head"><div><span class="eyebrow">MODEL SERVICE</span><h2>OpenAI 兼容接口</h2><p>模型只负责把业务描述转换成候选规则，最终校验和仿真仍由本地规则内核完成。</p></div><span class="status ${settings.configured ? "success" : "orange"}"><i></i>${status}</span></div>
          <div class="settings-form-grid">
            <label class="settings-field wide"><span>Base URL</span><input type="url" value="${esc(draft.baseUrl)}" data-model-setting="baseUrl" placeholder="https://api.example.com/v1"><small>公网地址必须使用 HTTPS；本机 localhost 可使用 HTTP。</small></label>
            <label class="settings-field"><span>模型名称</span><input value="${esc(draft.model)}" data-model-setting="model" placeholder="gpt-4.1-mini"></label>
            <label class="settings-field"><span>请求超时</span><span class="input-with-unit"><input type="number" min="5" max="120" step="1" value="${Math.round(Number(draft.timeoutMs || 30000) / 1000)}" data-model-setting="timeoutSeconds"><b>秒</b></span></label>
            <label class="settings-field wide"><span>API Key</span><input type="password" autocomplete="new-password" value="" data-model-setting="apiKey" placeholder="${esc(settings.keyMasked || "输入 API Key")}"><small>只发送给本地代理并保存在当前服务进程内存；刷新页面不会回显完整密钥。</small></label>
          </div>
          ${petState.modelSettingsError ? `<div class="settings-error" role="alert">${icon("shield",16)}<span>${esc(petState.modelSettingsError)}</span></div>` : ""}
          <div class="settings-actions">
            <button type="button" class="button" data-action="clear-model-settings" ${busy ? "disabled" : ""}>清除配置</button>
            <button type="button" class="button" data-action="test-model-settings" ${busy ? "disabled" : ""}>${busy ? "正在连接" : "测试连接"}</button>
            <button type="button" class="button primary" data-action="${petState.settingsReturnPath ? "save-model-settings-return" : "save-model-settings"}" ${busy ? "disabled" : ""}>${petState.settingsReturnPath ? "保存并返回策略实验" : "保存配置"}</button>
          </div>
        </section>
        <section class="glass-panel settings-security"><div class="section-heading"><div><span class="eyebrow">SECURITY</span><h2>密钥与调用边界</h2></div></div><div class="security-points"><div><i>1</i><span><strong>浏览器不保存密钥</strong><small>API Key 不进入 LocalStorage、日志或候选规则。</small></span></div><div><i>2</i><span><strong>服务重启即失效</strong><small>页面输入的密钥只在单用户代理进程内存中存在。</small></span></div><div><i>3</i><span><strong>模型不做最终决策</strong><small>未知字段、嵌套逻辑和最终拒赔会被服务端拒绝。</small></span></div></div></section>
      </div>`;
    const tested = settings.lastTest;
    const aside = `${contextTitle("模型服务", settings.configured ? "配置可用于策略解析" : "完成配置后才能调用模型")}<div class="aside-group"><span class="aside-label">连接状态</span>${kv("状态", status)}${kv("模型", esc(settings.model || draft.model || "未设置"))}${kv("密钥", esc(settings.keyMasked || "未设置"))}${tested ? kv("最近测试", `${esc(new Date(tested.testedAt).toLocaleString("zh-CN",{hour12:false}))} · ${number(tested.latencyMs)}ms`) : ""}</div><div class="aside-callout neutral"><strong>配置来源</strong><p>${settings.source === "ENVIRONMENT" ? "API Key 来自服务端环境变量。" : settings.configured ? "API Key 保存在当前 Node 服务进程内存。" : "尚未提供 API Key。"}</p></div>`;
    return { main, aside };
  }

  function lockedView(kicker, title, description, requirements, nextPath, nextLabel) { const main = `${petPageHeader(title)}<section class="glass-panel locked-panel"><span class="locked-icon">${icon("shield", 28)}</span><span class="status orange"><i></i>前置条件未满足</span><h2>请先完成上游事实处理</h2><div class="requirement-list">${requirements.map(item => `<div class="${item.done ? "done" : "pending"}"><i>${item.done ? "✓" : "!"}</i><span><strong>${item.label}</strong><small>${item.detail}</small></span></div>`).join("")}</div><a class="button primary" href="#${nextPath}">${nextLabel}</a></section>`; return { main, aside: `${contextTitle("页面已锁定", "Word流程的前置条件尚未满足")}${workflowStatus()}<div class="aside-callout neutral"><strong>为什么锁定？</strong><p>材料、审核、关系与规则必须在同一可追溯事实链上完成，避免用未确认事实直接进入仿真。</p></div>` }; }

  function renderPetPage(route) { if (route.path === "/pet/datasets") return renderPetDatasets(); if (route.path === "/pet/intake") return renderPetIntake(); if (route.path === "/pet/graph") return renderPetGraph(); if (route.path === "/pet/strategies") return renderPetStrategies(); if (route.path === "/pet/validation") return renderPetValidation(); if (route.path === "/pet/cases") return renderPetCases(); return renderPetSimulation(); }

  function renderConditionStats(run) {
    return `<div class="condition-stat-list">${run.conditionStats.map((item,indexValue) => {
      const rate = item.total ? item.matched / item.total * 100 : 0;
      return `<div><span class="condition-stat-index">${String(indexValue + 1).padStart(2,"0")}</span><span><strong>${esc(item.label)}</strong><small>命中 ${item.matched} / ${item.total} · 空值 ${item.missing}</small></span><i><b style="width:${Math.max(2,rate)}%"></b></i><em>${pct(rate,0)}</em></div>`;
    }).join("")}</div>`;
  }
  function renderRouteComparison(run) {
    const items = [["auto","自动审核"],["manual","人工复核"],["requestMore","请求补件"]], max = Math.max(...items.flatMap(([key]) => [run.oldSummary[key],run.newSummary[key]]),1);
    return `<div class="route-comparison">${items.map(([key,label]) => `<div><span>${label}</span><i><b class="old" style="width:${run.oldSummary[key]/max*100}%"></b></i><em>${run.oldSummary[key]}</em><i><b class="next" style="width:${run.newSummary[key]/max*100}%"></b></i><em>${run.newSummary[key]}</em></div>`).join("")}</div>`;
  }
  function renderPetSimulation() {
    const workflow = petState.workflow;
    if (!workflow.snapshotFrozen || !workflow.candidateSaved || !workflow.validationPassed) return lockedView("宠物险理赔 / 仿真总览", "策略仿真", "同一冻结快照上的现行与候选策略双跑。", [["FactSnapshot已冻结", workflow.snapshotFrozen, "本体事实与跨平台关系需先确认"], ["候选策略已保存", workflow.candidateSaved, "自然语言规则需确认并保存"], ["规则检查已通过", workflow.validationPassed, "确认边界、空值和动作权限"]].map(([label,done,detail]) => ({label,done,detail})), !workflow.snapshotFrozen ? "/pet/datasets" : !workflow.candidateSaved ? "/pet/strategies" : "/pet/validation", !workflow.snapshotFrozen ? "前往冻结快照" : !workflow.candidateSaved ? "前往策略实验" : "前往规则检查");
    if (!petState.run) {
      const main = `${petPageHeader("策略仿真")}<section class="glass-panel ready-panel"><span class="status success"><i></i>输入就绪</span><h2>可以开始确定性双跑</h2><p>候选规则包含 ${petState.candidateRule.conditions.length} 个条件，将按 ${petState.candidateRule.logic} 逻辑对全部冻结案件执行。</p>${button("运行仿真","run-pet-simulation",{primary:true,iconName:"play"})}</section>`;
      return { main, aside: `${contextTitle("仿真输入","冻结事实 + 已检查规则")}${workflowStatus()}${kv("快照",snapshotId())}${kv("规则Hash","<code>" + candidateRuleHash(petState.candidateRule) + "</code>")}` };
    }
    const run = petState.run, changedRate = run.changedRows.length / petClaims.length * 100, standard = run.isThresholdExperiment, impactBand = !standard ? "" : run.threshold > 200 ? "200 < 费用 ≤ " + number(run.threshold) + "（规则放宽）" : run.threshold < 200 ? number(run.threshold) + " < 费用 ≤ 200（规则收紧）" : "阈值不变";
    const experimentVisual = standard ? `<div class="threshold-visual" aria-label="现行阈值200元调整为候选阈值${number(run.threshold)}元"><div class="threshold-label baseline"><span>现行规则</span><strong>${money(200)}</strong></div><div class="threshold-track"><i class="baseline-dot"></i><span></span><i class="candidate-dot" style="left:${Math.min(92,8+run.threshold/7)}%"></i></div><div class="threshold-label candidate"><span>候选规则</span><strong>${money(run.threshold)}</strong></div></div><div class="impact-scope"><span>上海</span><span>急性肠胃炎</span><span>严格大于</span><span class="impact-band">影响区间：${esc(impactBand)}</span></div>` : `<div class="compiled-experiment"><div><span>适用范围</span><strong>${esc(ruleScopeLabel(run.candidate))}</strong></div><div><span>条件逻辑</span><strong>${run.candidate.conditions.length} 条 · ${run.candidate.logic}</strong></div><div><span>空值处理</span><strong>${run.candidate.onMissing === "REQUEST_MORE" ? "请求补件" : "按未命中"}</strong></div><div><span>规则Hash</span><code>${run.ruleHash}</code></div></div>`;
    const leadChart = standard ? `<article class="glass-panel chart-panel"><div class="section-heading"><div><span class="eyebrow">OBSERVED REPLAY</span><h2>保障费用分布</h2><p>上海肠胃炎成熟样本，单位：案件数</p></div><div class="chart-key"><span><i class="old"></i>现行阈值 200</span><span><i class="next"></i>候选阈值 ${number(run.threshold)}</span></div></div>${renderDistribution(run)}</article>` : `<article class="glass-panel chart-panel"><div class="section-heading"><div><span class="eyebrow">CONDITION HIT</span><h2>条件命中分布</h2><p>仅统计候选策略适用范围内案件。</p></div><span class="status blue"><i></i>${run.candidate.logic}</span></div>${renderConditionStats(run)}</article>`;
    const main = `${petPageHeader("策略仿真")}
      <section class="experiment-hero glass-panel"><div class="experiment-heading"><div class="experiment-copy"><span class="status blue"><i></i>${standard ? "单变量实验" : "通用规则实验"}</span><h2>${standard ? "上海肠胃炎保障费用阈值" : esc(ruleScopeLabel(run.candidate))}</h2><p>${standard ? "仅改变covered_expense阈值，其他输入保持冻结。" : esc(ruleSummary(run.candidate))}</p></div>${button(petState.running ? "正在计算" : "运行仿真","run-pet-simulation",{primary:true,iconName:"play",disabled:petState.running})}</div>${experimentVisual}</section>
      <section class="kpi-grid">${kpi("受影响案件",number(run.changedRows.length),pct(changedRate) + " 的回放案件","OBSERVED_REPLAY","case")}${kpi("覆盖建议增量",signed(run.coveredDelta),"保障建议变化 " + run.coverageChangedCount + " 笔","OBSERVED_REPLAY","covered")}${kpi("核定赔付变化",signed(run.payoutDelta,shortMoney),"新策略 " + shortMoney(run.newSummary.payable),"ESTIMATE","payout")}${kpi("人工工时变化",signed(run.workHoursDelta,value => number(value,1) + "h"),"路由变化 " + run.routeChangedCount + " 笔","ASSUMPTION","workload")}</section>
      <section class="analytics-grid">${leadChart}<article class="glass-panel chart-panel compact"><div class="section-heading"><div><span class="eyebrow">DECISION MIX</span><h2>建议与路由构成</h2><p>灰色为现行，蓝色为候选。</p></div></div><div class="donut-pair">${renderDonut("现行",run.oldSummary.covered,run.oldSummary.notCovered,"现行规则")}${renderDonut("候选",run.newSummary.covered,run.newSummary.notCovered,"候选规则")}</div>${renderRouteComparison(run)}</article></section>
      <section class="glass-panel migration-panel"><div class="section-heading"><div><span class="eyebrow">CASE MIGRATION</span><h2>策略迁移与影响客群</h2><p>迁移由已确认候选规则产生，可下钻逐条件执行轨迹。</p></div><a class="text-link" href="#/pet/cases?transition=CHANGED">查看全部案例 ${icon("arrow",15)}</a></div><button class="migration-row" data-action="open-changed-cases"><span class="migration-route">现行决策 <b>→</b> 候选决策</span><span class="migration-band">${esc(ruleSummary(run.candidate))}</span><strong>${run.changedRows.length} 笔</strong><span class="migration-amount">赔付 ${signed(run.payoutDelta,shortMoney)}</span>${icon("arrow",17)}</button></section>`;
    const aside = `${contextTitle("本次仿真","所有输入均已冻结")}<div class="run-health"><span class="health-ring"><b>100</b><small>健康度</small></span><div><strong>可复现</strong><p>固定种子、规则Hash与事实快照</p></div></div><div class="aside-group"><span class="aside-label">事实快照</span>${kv("Snapshot",snapshotId())}${kv("Hash","<code>"+snapshotHash()+"</code>")}${kv("冻结时间",snapshotFrozenAt())}</div><div class="aside-group"><span class="aside-label">规则版本</span>${kv("现行",BASELINE.id)}${kv("候选",run.candidate.id)}${kv("解析器",RULE_PARSER_VERSION)}${kv("规则Hash","<code>"+run.ruleHash+"</code>")}</div><div class="aside-group"><span class="aside-label">业务假设</span><p class="aside-note">人工复核0.45小时/案，补件0.15小时/案，综合成本120元/小时。</p></div><div class="aside-actions">${button("导出仿真摘要","export-pet-report",{iconName:"download"})}</div>`;
    return { main, aside };
  }
  function renderDistribution(r) { const w = 720, h = 250, l = 38, top = 18, bottom = 38, max = Math.max(...r.distribution.map(b => b.count), 1), points = r.distribution.map((b, i) => [l + i * ((w - l - 16) / (r.distribution.length - 1)), top + (1 - b.count / max) * (h - top - bottom)]), line = points.map(p => p.join(",")).join(" "), area = `${l},${h - bottom} ${line} ${points.at(-1)[0]},${h - bottom}`, tx = value => l + Math.min(800, value) / 800 * (w - l - 16); return `<svg class="distribution-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="上海肠胃炎案件保障费用分布"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4d8dff" stop-opacity=".24"/><stop offset="1" stop-color="#4d8dff" stop-opacity="0"/></linearGradient></defs><g class="grid-lines">${[0,1,2,3].map(i => `<line x1="${l}" x2="${w-16}" y1="${top+i*52}" y2="${top+i*52}"/>`).join("")}</g><rect class="impact-zone" x="${Math.min(tx(200), tx(r.threshold))}" y="${top}" width="${Math.abs(tx(r.threshold)-tx(200))}" height="${h-top-bottom}" rx="6"/><polygon points="${area}" fill="url(#areaFill)"/><polyline points="${line}" class="distribution-line"/><line class="threshold-line old" x1="${tx(200)}" x2="${tx(200)}" y1="${top}" y2="${h-bottom}"/><line class="threshold-line next" x1="${tx(r.threshold)}" x2="${tx(r.threshold)}" y1="${top}" y2="${h-bottom}"/><g class="axis-labels">${[0,200,400,600,800].map(v => `<text x="${tx(v)}" y="${h-12}" text-anchor="middle">¥${v}</text>`).join("")}</g><text class="threshold-text old" x="${tx(200)-5}" y="${top+12}" text-anchor="end">现行 200</text><text class="threshold-text next" x="${tx(r.threshold)+5}" y="${top+28}">候选 ${number(r.threshold)}</text></svg>`; }
  function renderDonut(label, covered, notCovered, threshold) { const total = covered + notCovered, rate = total ? covered / total * 100 : 0; return `<div class="donut-block"><div class="donut" style="--covered:${rate}%"><div><strong>${pct(rate, 0)}</strong><span>覆盖建议</span></div></div><span>${label} · ${threshold}</span><small>${covered} 覆盖 / ${notCovered} 不覆盖</small></div>`; }

  function renderPetDatasets() {
    const selected = PET_DATASETS.find(item => item.id === petState.dataset) || PET_DATASETS[0];
    const ready = petState.workflow.ontologyConfirmed, frozen = petState.workflow.snapshotFrozen;
    const main = `${petPageHeader("数据与事实快照")}
      <section class="glass-panel snapshot-hero ${frozen ? "" : "draft"}"><div class="snapshot-icon">${icon("shield", 26)}</div><div><span class="status ${frozen ? "success" : "orange"}"><i></i>${frozen ? "已冻结" : "草稿"}</span><h2>${snapshotId()}</h2><p>${selected.name} · ${number(selected.rows)}笔案件 · ${number(selected.evidence)}份证据</p></div><div class="snapshot-hash"><span>内容哈希</span><code>${snapshotHash()}</code></div><div class="snapshot-actions">${button(frozen ? "已冻结" : "冻结 FactSnapshot", "freeze-snapshot", { primary: true, iconName: "shield", disabled: !ready || frozen })}</div></section>
      <section class="glass-panel"><div class="section-heading"><div><span class="eyebrow">QUALITY PROFILE</span><h2>快照质量与边界样本</h2><p>边界样本作为策略比较的自动化验收夹具。</p></div></div><div class="quality-grid"><div><span>字段完整度</span><strong>98.2%</strong><i style="--value:98.2%"></i></div><div><span>OCR证据可追溯</span><strong>96.8%</strong><i style="--value:96.8%"></i></div><div><span>本体关系覆盖</span><strong>94.7%</strong><i style="--value:94.7%"></i></div></div><div class="boundary-strip">${[199, 200, 200.01, 499.99, 500, 500.01].map(value => `<span><code>${money(value, value % 1 ? 2 : 0)}</code><b>${isStandardThresholdRule(petState.candidateRule) ? (value > candidateThreshold(petState.candidateRule) ? "不覆盖建议" : "覆盖建议") : "边界样本"}</b></span>`).join("")}</div></section>`;
    const aside = `${contextTitle("当前快照", frozen ? "只读、可追溯、可复现" : "等待人工确认后冻结")}${workflowStatus()}<div class="aside-group"><span class="aside-label">版本链</span>${kv("数据", SNAPSHOT.dataset)}${kv("OCR", SNAPSHOT.ocr)}${kv("人工图片审核", SNAPSHOT.vision)}${kv("本体图谱", SNAPSHOT.ontology)}${kv("固定种子", SNAPSHOT.seed)}</div><div class="aside-callout"><strong>为什么要冻结？</strong><p>同一快照保证结果差异只来自候选规则，而不是数据、识别或本体版本变化。</p></div>${!ready ? `<div class="aside-actions"><a class="button primary" href="#/pet/graph">前往本体关系确认</a></div>` : ""}`;
    return { main, aside };
  }

  function selectedClaim() { return petClaims.find(item => item.id === petState.selectedClaimId) || petClaims[0]; }
  function claimList(claim, limit = 18) { return `<div class="claim-list">${petClaims.slice(0, limit).map(item => `<button class="claim-row ${item.id === claim.id ? "selected" : ""}" data-action="select-pet-claim" data-id="${item.id}"><span class="pet-avatar">${item.species}</span><span><strong>${esc(item.petName)}</strong><small>${item.id}<br>${item.region} · ${item.disease}</small></span><b>${money(item.coveredExpense, 2)}</b></button>`).join("")}</div>`; }

  function reviewTag(code) { return IMAGE_REVIEW_TAGS.find(item => item.code === code); }
  function defaultReviewTag(status) { return status === "PASS" ? "MATERIAL_MATCH" : status === "FAIL" ? "IMAGE_BLUR" : status === "NEEDS_REVIEW" ? "INSUFFICIENT" : ""; }
  function currentReview(claim, evidenceId) { const key = `${claim.id}:${evidenceId}`, saved = petState.reviews[key], isUpload = evidenceId.startsWith("upload-"), status = saved?.status ?? (isUpload ? "" : claim.imageCompliance), tagCode = saved?.tagCode || defaultReviewTag(status), tag = reviewTag(tagCode); return { status, tagCode, tagLabel: saved?.tagLabel || tag?.label || "", comment: saved?.comment ?? (status === "PASS" ? "" : isUpload ? "" : "请核对图片质量与案件材料的一致性。"), reviewer: saved?.reviewer || (isUpload ? "未审核" : "演示审核员"), version: saved?.version ?? (isUpload ? 0 : 1), reviewedAt: saved?.reviewedAt || (isUpload ? "未保存" : "2026-08-14 10:22"), sourceHash: saved?.sourceHash || `sha256:${stableHash(key)}…` }; }
  function mergedReview(claim, evidenceId) { const key = `${claim.id}:${evidenceId}`; return { ...currentReview(claim, evidenceId), ...(petState.reviewDraft[key] || {}) }; }
  function reviewErrors(review) { const errors = []; if (!review.status) errors.push("请选择人工审核结论"); const tag = reviewTag(review.tagCode); if (!tag || !tag.statuses.includes(review.status)) errors.push("请选择与审核结论匹配的问题标签"); if (["FAIL", "NEEDS_REVIEW"].includes(review.status) && !String(review.comment || "").trim()) errors.push("不通过或需要复核时，人工审核意见为必填项"); return errors; }
  function reviewStatusLabel(status) { return status === "PASS" ? "通过" : status === "FAIL" ? "不通过" : status === "NEEDS_REVIEW" ? "需要复核" : "待选择"; }
  function renderManualReviewPanel(claim, selected, review) { const errors = reviewErrors(review), allowedTags = IMAGE_REVIEW_TAGS.filter(item => item.statuses.includes(review.status)), commentRequired = ["FAIL", "NEEDS_REVIEW"].includes(review.status); return `<div class="document-review manual-review-workspace"><div class="document-canvas manual-image-canvas"><img src="${selected.previewUrl || `./assets/pet-demo/${selected.file}`}" alt="${selected.type}"><span class="manual-badge">人工审核</span></div><div class="review-form manual-review-panel"><span class="eyebrow">HUMAN REVIEW</span><h3>人工审核判断</h3><span class="review-field-label">审核结论 <b>*</b></span><div class="review-options">${["PASS", "FAIL", "NEEDS_REVIEW"].map(status => `<button class="review-option ${review.status === status ? "active" : ""} ${status.toLowerCase()}" data-action="set-review-status" data-status="${status}"><i></i><span>${reviewStatusLabel(status)}</span><small>${status}</small></button>`).join("")}</div><label class="field review-tag-field"><span>问题标签 <b>*</b></span><select data-input="review-tag" required ${review.status ? "" : "disabled"}><option value="">${review.status ? "请选择问题标签" : "请先选择审核结论"}</option>${allowedTags.map(tag => `<option value="${tag.code}" ${review.tagCode === tag.code ? "selected" : ""}>${tag.label}</option>`).join("")}</select></label><label class="field ${commentRequired ? "required" : ""}"><span>人工审核意见 ${commentRequired ? "<b>*</b>" : "<small>通过时选填</small>"}</span><textarea data-input="review-comment" rows="5" aria-required="${commentRequired}">${esc(review.comment)}</textarea></label><div class="review-validation ${errors.length ? "error" : "success"}" data-review-validation>${errors.length ? errors.map(item => `<span>${item}</span>`).join("") : "<span>人工审核信息完整，可以保存</span>"}</div>${button("保存人工审核结果", "save-image-review", { primary: true, disabled: errors.length > 0 })}<p class="form-hint">结果由人工确认并留痕，不产生自动医疗诊断或最终拒赔。</p></div></div>`; }
  function renderRecognitionPanel(selected, intakeDone) { return `<div class="document-review"><div class="document-canvas"><img src="${selected.previewUrl || `./assets/pet-demo/${selected.file}`}" alt="${selected.type}模拟资料"><span class="demo-stamp">模拟资料</span><span class="ocr-box one">诊断 / 金额</span><span class="ocr-box two">日期 / 明细</span></div><div class="recognition-panel"><span class="eyebrow">LOCAL DEMO RECOGNITION</span><h3>${selected.type}</h3><div class="confidence"><span>识别置信度</span><strong>${pct(selected.confidence * 100)}</strong><i style="--value:${selected.confidence * 100}%"></i></div>${kv("文件登记", `${selected.name || selected.file} · SHA-256`)}${kv("OCR结果", selected.result)}${kv("候选事实", `<code>${selected.fact}</code>`)}${kv("证据定位", "page 1 · bbox [84, 126, 612, 204]")}<div class="fact-status"><span class="status ${intakeDone ? "success" : "orange"}"><i></i>${intakeDone ? "登记与OCR已核对" : "等待批次确认"}</span><small>${intakeDone ? "文本材料已完成" : "尚未写入快照"}</small></div></div></div>`; }

  function renderPetIntake() {
    const claim = selectedClaim(), evidence = evidenceFor(claim), selected = evidence.find(item => item.id === petState.selectedEvidenceId) || evidence[0], decision = decideCandidateRule(claim, petState.candidateRule), intakeDone = petState.workflow.materialsRegistered && petState.workflow.ocrValidated, isDiagnosticImage = selected.type === "诊疗图片", review = isDiagnosticImage ? mergedReview(claim, selected.id) : null, savedRecord = isDiagnosticImage ? petState.reviews[`${claim.id}:${selected.id}`] : null, savedReview = savedRecord ? currentReview(claim, selected.id) : null, savedReviewValid = Boolean(savedReview && reviewErrors(savedReview).length === 0);
    petState.selectedEvidenceId = selected.id;
    const evidenceBody = isDiagnosticImage ? renderManualReviewPanel(claim, selected, review) : renderRecognitionPanel(selected, intakeDone);
    const main = `${petPageHeader("材料审核")}
      <section class="workbench-toolbar glass-panel"><div><strong>案件与材料</strong><span>${claim.id} · ${evidence.length} 份材料</span></div><div><label class="button primary" for="evidence-upload">${icon("upload", 17)}<span>上传材料</span></label><input class="visually-hidden" id="evidence-upload" type="file" accept="image/*,.pdf" data-input="evidence-upload"></div></section>
      <div class="intake-workspace workbench-fill"><section class="queue-column glass-panel"><div class="mini-heading"><span>案件队列</span><b>${petClaims.length}</b></div>${claimList(claim)}</section><section class="evidence-column glass-panel"><div class="claim-summary"><div><span class="eyebrow">理赔单号：${claim.id}</span><h2>${claim.petName} · ${claim.disease}</h2><p>保单号：${claim.policyId} · ${claim.hospital}</p></div>${routeBadge(decision.processingRoute)}</div><div class="evidence-tabs">${evidence.map(item => `<button class="evidence-tab ${item.id === selected.id ? "active" : ""}" data-action="select-evidence" data-id="${item.id}">${item.type}</button>`).join("")}</div>${evidenceBody}</section></div>`;
    const textAside = `${contextTitle("案件事实", `${claim.id} · ${claim.petName}`)}${workflowStatus()}<div class="aside-group"><span class="aside-label">实验关键字段</span>${kv("地区", claim.region)}${kv("疾病本体", `${claim.disease}<small>${claim.diseaseCode}</small>`)}${kv("可覆盖费用", money(claim.coveredExpense, 2))}${kv("材料完整", claim.materialComplete == null ? "缺失" : claim.materialComplete ? "是" : "否")}</div><div class="aside-group"><span class="aside-label">本页输出</span>${kv("材料登记", intakeDone ? "完成" : "待确认")}${kv("OCR证据", intakeDone ? "已核对" : "候选")}${kv("结构化字段", intakeDone ? "已标准化" : "待标准化")}</div><div class="aside-callout neutral"><strong>当前材料职责</strong><p>文本材料完成文件登记、证据定位和结构化字段校验；诊疗图片切换至人工审核判断。</p></div><div class="aside-actions">${button(intakeDone ? "文本材料已确认" : "完成材料登记与OCR校验", "complete-intake", { primary: true, iconName: "check", disabled: intakeDone })}${intakeDone ? button("前往诊疗图片人工审核", "open-diagnostic-image") : ""}${button("重置演示流程", "reset-pet-workflow")}</div>`;
    const imageAside = isDiagnosticImage ? `${contextTitle("人工审核记录", `${claim.id} / ${selected.id}`)}${workflowStatus(true)}<div class="aside-group"><span class="aside-label">当前判断</span>${kv("审核结论", `<strong class="review-code ${(review.status || "pending").toLowerCase()}">${reviewStatusLabel(review.status)}</strong>`)}${kv("问题标签", review.tagLabel || "待选择")}${kv("人工意见", review.comment || "未填写")}</div><div class="aside-group"><span class="aside-label">审核留痕</span>${kv("审核员", review.reviewer)}${kv("时间", review.reviewedAt)}${kv("版本", `v${review.version}`)}${kv("源文件哈希", `<code>${review.sourceHash}</code>`)}</div><div class="aside-callout"><strong>处置约束</strong><p>不通过或需要复核只会形成风险线索并进入人工处理，不直接产生最终拒赔。</p></div><div class="aside-actions">${!intakeDone ? button("先完成文本材料核对", "complete-intake", { primary: true }) : button(petState.workflow.imageReviewComplete ? "本案件图片已审核" : "完成材料审核并构建本体图谱", "complete-image-review", { primary: true, iconName: "check", disabled: !savedReviewValid || petState.workflow.imageReviewComplete })}${button("重置演示流程", "reset-pet-workflow")}</div>` : "";
    return { main, aside: isDiagnosticImage ? imageAside : textAside };
  }

  function maskedReference(value, prefix) { return `${prefix}-****${String(value).replace(/\D/g, "").slice(-3).padStart(3, "0")}`; }

  function ontologyHierarchy(claim) {
    const masterSuffix = claim.petName === "团子" ? "668" : String(100 + (Number(claim.id.slice(-3)) * 37) % 900).padStart(3, "0"), masterId = `****${masterSuffix}`, petBreed = claim.species === "犬" ? "柯基" : "英国短毛猫";
    const record = (id, label, localId, eventTime, summary, extra = {}) => ({ id, level: "record", nodeType: "具体记录", label, localId, eventTime, summary, relationLabel: "包含记录", matchMethod: "平台原始记录归类", confidence: .97, relationStatus: "EXPLICIT", evidence: "平台记录摘要", effectivePeriod: eventTime, ...extra });
    const category = (id, label, records) => ({ id, level: "category", nodeType: "数据类别", label, localId: `${records.length} 条记录`, records, relationLabel: "包含类别", matchMethod: "平台字段映射", confidence: .98, relationStatus: "EXPLICIT", evidence: "平台数据字典", effectivePeriod: "当前版本" });
    const platforms = [
      { id: "platform-atlantic", level: "platform", nodeType: "数据平台", label: "大西洋保险", platformType: "保险平台", kind: "insurance", localId: `ATL-${masterId}`, matchMethod: "保单登记宠物编号精确匹配", confidence: .99, relationStatus: "MATCHED", evidence: "投保信息与保单主档", effectivePeriod: "2025-07-01 至 2026-06-30", categories: [
        category("atl-insured", "投保信息", [record("atl-insured-record", `${claim.petName}投保档案`, `INS-${masterId}`, "2025-07-01", `${claim.species} · ${petBreed} · ${claim.region}`)]),
        category("atl-policy", "保单", [record("atl-policy-record", "宠物医疗费用险", maskedReference(claim.policyId, "POL"), "2025-07-01", "保单有效 · 剩余额度已核验")]),
        category("atl-current-claim", "当前理赔", [record("atl-current-claim-record", "肠胃炎理赔申请", maskedReference(claim.id, "CLM"), claim.admissionDate, `${money(claim.claimAmount, 2)} · 材料已登记`)]),
        category("atl-history", "历史理赔", [record("atl-history-record", "既往门诊理赔", "CLM-****842", "2025-11-06", "已结案 · 无拒赔记录")]),
      ] },
      { id: "platform-zhejiang", level: "platform", nodeType: "数据平台", label: "浙江华西医院", platformType: "医疗平台", kind: "medical", localId: "HIS-****128", matchMethod: "保单宠物与医院档案匹配", confidence: .98, relationStatus: "MATCHED", evidence: "保单登记与医院门诊档案", effectivePeriod: "2026-01-01 至今", categories: [
        category("zj-visit", "就诊记录", [record("zj-visit-record", "急性肠胃炎门诊", "VIS-****612", claim.admissionDate, "主诉呕吐、腹泻 · 门诊治疗")]),
        category("zj-diagnosis", "诊断", [record("zj-diagnosis-record", claim.disease, "DX-****031", claim.admissionDate, `${claim.diseaseCode} · 人工确认`)]),
        category("zj-lab", "检验", [record("zj-lab-record", "血常规与粪检", "LAB-****204", claim.admissionDate, "检验报告已核对")]),
        category("zj-prescription", "处方", [record("zj-prescription-record", "门诊处方", "RX-****482", claim.admissionDate, "药品与诊断关联")]),
        category("zj-expense", "费用票据", [record("zj-expense-record", "门诊费用发票", "INV-****091", claim.admissionDate, `${money(claim.claimAmount, 2)} · 可覆盖${money(claim.coveredExpense, 2)}`)]),
        category("zj-image", "诊疗图片", [record("zj-image-record", "诊疗图片审核记录", "IMG-****369", claim.admissionDate, "人工审核结果已留痕", { evidence: "人工图片审核记录", confidence: 1 })]),
      ] },
      { id: "platform-xiehe", level: "platform", nodeType: "数据平台", label: "协合医院", platformType: "医疗平台", kind: "medical", localId: "HIS-****407", matchMethod: "名称、品种、生日与主人联系方式组合匹配", confidence: .86, relationStatus: "NEEDS_VERIFICATION", evidence: "历史门诊档案与投保资料", effectivePeriod: "2024-09-18 至 2025-12-20", categories: [
        category("xh-visit", "历史就诊", [record("xh-visit-record", "消化道不适门诊", "VIS-****118", "2025-12-20", "历史就诊 · 待人工核验", { relationStatus: "NEEDS_VERIFICATION", confidence: .86 })]),
        category("xh-diagnosis", "历史诊断", [record("xh-diagnosis-record", "胃肠功能紊乱", "DX-****329", "2025-12-20", "历史诊断摘要", { relationStatus: "NEEDS_VERIFICATION", confidence: .84 })]),
        category("xh-exam", "检查", [record("xh-exam-record", "腹部影像检查", "EXM-****544", "2025-12-20", "检查结果无结构异常", { confidence: .88 })]),
        category("xh-medication", "用药", [record("xh-medication-record", "历史处方记录", "RX-****077", "2025-12-20", "短期对症用药", { confidence: .88 })]),
      ] },
      { id: "platform-pay", level: "platform", nodeType: "数据平台", label: "支付吧平台", platformType: "支付平台", kind: "payment", localId: "PAY-****931", matchMethod: "医院商户号与发票订单映射", confidence: .92, relationStatus: "MATCHED", evidence: "支付订单与发票摘要", effectivePeriod: `${claim.admissionDate} 至今`, categories: [
        category("pay-order", "支付订单", [record("pay-order-record", "门诊支付订单", "ORD-****512", claim.admissionDate, `${money(claim.claimAmount, 2)} · 支付成功`, { confidence: .94 })]),
        category("pay-account", "收款账户", [record("pay-account-record", "医院商户账户", "ACC-****931", claim.admissionDate, "收款主体与就诊医院一致", { confidence: .93 })]),
        category("pay-refund", "退款", [record("pay-refund-record", "退款记录", "REF-****000", claim.admissionDate, "未发现退款", { confidence: .91 })]),
        category("pay-duplicate", "疑似重复支付", [record("pay-duplicate-record", "相似订单核验", "CHK-****711", claim.admissionDate, "相似度72% · 待核验", { relationStatus: "NEEDS_VERIFICATION", confidence: .72, evidence: "订单金额与时间窗口比对" })]),
      ] },
      { id: "platform-pet-record", level: "platform", nodeType: "数据平台", label: "萌宠档案平台", platformType: "宠物登记平台", kind: "registry", localId: `REG-${masterId}`, matchMethod: "芯片号尾号精确匹配", confidence: .995, relationStatus: "MATCHED", evidence: "芯片登记与主人档案", effectivePeriod: "2023-04-18 至今", categories: [
        category("reg-identity", "宠物身份", [record("reg-identity-record", `${claim.petName}身份档案`, `PET-${masterId}`, "2023-04-18", `${claim.species} · ${petBreed}`)]),
        category("reg-chip", "芯片", [record("reg-chip-record", "芯片登记", `CHIP-${masterId}`, "2023-04-18", "芯片状态有效", { confidence: 1 })]),
        category("reg-owner", "主人", [record("reg-owner-record", "主人档案", maskedReference(claim.ownerId, "OWN"), "2023-04-18", "联系方式已脱敏")]),
        category("reg-family", "同窝与家系", [record("reg-family-record", "同窝宠物关系", "FAM-****274", "2023-04-18", "家系疾病仅作为风险线索", { relationStatus: "NEEDS_VERIFICATION", confidence: .72, evidence: "宠物登记与主人确认记录" })]),
      ] },
    ];
    petState.connections.forEach(connection => platforms.push(connectionToOntologyPlatform(connection, claim)));
    platforms.forEach(platform => { platform.recordCount = platform.categories.reduce((sum, item) => sum + item.records.length, 0); platform.categories.forEach(item => { item.platformId = platform.id; item.platformLabel = platform.label; item.kind = platform.kind; item.records.forEach(recordItem => { recordItem.platformId = platform.id; recordItem.platformLabel = platform.label; recordItem.categoryId = item.id; recordItem.categoryLabel = item.label; recordItem.kind = platform.kind; }); }); });
    return { id: "pet-master", level: "root", nodeType: "宠物主实体", label: claim.petName, localId: masterId, summary: `${claim.species} · ${petBreed}`, eventTime: "主实体", matchMethod: "跨平台主实体归并", confidence: 1, relationStatus: petState.workflow.ontologyConfirmed ? "HUMAN_CONFIRMED" : "MATCHED", evidence: "保单、芯片与医院档案", effectivePeriod: "当前有效", kind: "pet", platforms };
  }

  function ontologyIndex(claim) {
    const root = ontologyHierarchy(claim), nodes = [], nodeById = new Map(), parentById = new Map(), childrenById = new Map(), relationByChild = new Map();
    const childrenOf = node => node.level === "root" ? node.platforms : node.level === "platform" ? node.categories : node.level === "category" ? node.records : [];
    const visit = (node, parent = null) => { const children = childrenOf(node), normalized = { ...node, parentId: parent?.id || null, childIds: children.map(child => child.id) }; nodes.push(normalized); nodeById.set(node.id, normalized); childrenById.set(node.id, normalized.childIds); if (parent) { parentById.set(node.id, parent.id); relationByChild.set(node.id, { id: `${parent.id}:${node.id}`, from: parent.id, to: node.id, label: node.relationLabel || "关联平台", matchMethod: node.matchMethod, confidence: node.confidence, relationStatus: petState.workflow.ontologyConfirmed ? "HUMAN_CONFIRMED" : node.relationStatus, evidence: node.evidence, effectivePeriod: node.effectivePeriod }); } children.forEach(child => visit(child, normalized)); };
    visit(root);
    return { root: nodeById.get(root.id), nodes, nodeById, parentById, childrenById, relationByChild };
  }

  function ontologyFocusView(claim, requestedId = petState.focusNodeId) {
    const index = ontologyIndex(claim), focusNode = index.nodeById.get(requestedId) || index.root, parentNode = focusNode.parentId ? index.nodeById.get(focusNode.parentId) : null, childLimit = focusNode.level === "root" ? 10 : 7, childNodes = (focusNode.childIds || []).map(id => index.nodeById.get(id)).filter(Boolean).slice(0, childLimit), breadcrumb = []; let cursor = focusNode; while (cursor) { breadcrumb.unshift(cursor); cursor = cursor.parentId ? index.nodeById.get(cursor.parentId) : null; }
    const focusRelation = index.relationByChild.get(focusNode.id), propertyBubbles = focusNode.level === "record" ? [
      { id: `property-time:${focusNode.id}`, label: "记录时间", value: focusNode.eventTime || "未记录", kind: "property" },
      { id: `property-status:${focusNode.id}`, label: "关系状态", value: focusRelation?.relationStatus || focusNode.relationStatus, kind: "property" },
      { id: `property-source:${focusNode.id}`, label: "来源证据", value: focusRelation?.evidence || focusNode.evidence, kind: "property" },
      { id: `property-confidence:${focusNode.id}`, label: "置信度", value: pct((focusRelation?.confidence ?? focusNode.confidence) * 100), kind: "property" },
    ] : [];
    const center = { x: 450, y: 270 }, bubbles = [{ ...focusNode, x: center.x, y: center.y, radius: 66, angle: 0, interactive: false, bubbleRole: "focus" }], satellites = [];
    if (parentNode) satellites.push({ ...parentNode, bubbleRole: "parent", relation: index.relationByChild.get(focusNode.id) });
    childNodes.forEach(node => satellites.push({ ...node, bubbleRole: "child", relation: index.relationByChild.get(node.id) }));
    propertyBubbles.forEach(node => satellites.push({ ...node, level: "property", nodeType: "记录属性", bubbleRole: "property", relation: { label: "记录属性" } }));
    const domainSatellites = satellites.filter(node => node.bubbleRole !== "property"), propertySatellites = satellites.filter(node => node.bubbleRole === "property"), positioned = [];
    if (!parentNode) domainSatellites.forEach((node, indexValue) => { const crowded = domainSatellites.length > 7, angle = -90 + indexValue * 360 / Math.max(1, domainSatellites.length), radians = angle * Math.PI / 180, radiusX = crowded ? 270 : 245, radiusY = crowded ? 190 : 168; positioned.push({ ...node, x: center.x + Math.cos(radians) * radiusX, y: center.y + Math.sin(radians) * radiusY, radius: node.level === "platform" ? (crowded ? 38 : 46) : 42, angle, interactive: true }); });
    else {
      const parent = domainSatellites.shift(); positioned.push({ ...parent, x: center.x - 245, y: center.y, radius: parent.level === "root" ? 50 : 44, angle: 180, interactive: true });
      domainSatellites.forEach((node, indexValue) => { const count = domainSatellites.length, angle = count === 1 ? 0 : -108 + indexValue * 216 / Math.max(1, count - 1), radians = angle * Math.PI / 180; positioned.push({ ...node, x: center.x + Math.cos(radians) * 238, y: center.y + Math.sin(radians) * 174, radius: node.level === "platform" ? 46 : node.level === "category" ? 40 : 38, angle, interactive: true }); });
      propertySatellites.forEach((node, indexValue) => { const angles = [-92, -30, 30, 92], angle = angles[indexValue] ?? (indexValue * 60), radians = angle * Math.PI / 180; positioned.push({ ...node, x: center.x + Math.cos(radians) * 220, y: center.y + Math.sin(radians) * 158, radius: 31, angle, interactive: false }); });
    }
    bubbles.push(...positioned);
    const relations = positioned.map(node => ({ id: `focus-line:${node.id}`, from: node.bubbleRole === "parent" ? node.id : focusNode.id, to: node.bubbleRole === "parent" ? focusNode.id : node.id, label: node.relation?.label || "关联", relation: node.relation }));
    return { ...index, focusNode, parentNode, childNodes, propertyBubbles, breadcrumb, focusRelation, bubbles, relations, width: 900, height: 540, center };
  }

  function ontologyStatus(code) { const tone = code === "HUMAN_CONFIRMED" ? "success" : code === "NEEDS_VERIFICATION" ? "orange" : "blue"; return `<span class="status ${tone}"><i></i>${code}</span>`; }
  function bubbleLabelLines(label, max = 7) { const text = String(label || ""); return text.length <= max ? [text] : [text.slice(0, max), text.slice(max, max * 2)]; }
  function bubbleMeta(node) { if (node.bubbleRole === "property") return node.value; if (node.bubbleRole === "focus") return node.localId; if (node.level === "platform") return `${node.recordCount} 条记录`; return node.localId || node.nodeType; }

  function renderBubble(node) {
    const lines = bubbleLabelLines(node.label, node.bubbleRole === "focus" ? 9 : node.bubbleRole === "property" ? 5 : 7), meta = bubbleMeta(node), interactive = node.interactive, labelStart = lines.length === 1 ? -5 : -12;
    return `<g class="ontology-bubble ${node.kind || "neutral"} ${node.level} ${node.bubbleRole} ${petState.newConnectionId === node.id ? "connection-highlight" : ""}" transform="translate(${node.x} ${node.y})" data-node-id="${node.id}" data-x="${node.x}" data-y="${node.y}" data-radius="${node.radius}" ${interactive ? `data-action="focus-ontology-node" data-id="${node.id}" role="button" tabindex="0"` : `role="img" tabindex="${node.bubbleRole === "focus" ? "0" : "-1"}"`} aria-label="${esc(node.nodeType || "属性")} ${esc(node.label)}"><title>${esc(node.label)} · ${esc(meta)}</title><circle r="${node.radius}"/>${lines.map((line, indexValue) => `<text class="bubble-label" y="${labelStart + indexValue * 13}" text-anchor="middle">${esc(line)}</text>`).join("")}<text class="bubble-meta" y="${lines.length === 1 ? 14 : 19}" text-anchor="middle">${esc(meta).slice(0, node.bubbleRole === "focus" ? 20 : 12)}</text></g>`;
  }

  function renderPetGraph() {
    if (!petState.workflow.imageReviewComplete) return lockedView("宠物险理赔 / 本体图谱", "跨平台本体图谱", "诊疗图片人工审核登记后，才能匹配宠物主实体与跨平台记录。", [{ label: "诊疗图片人工审核结果已登记", done: false, detail: "诊疗图片需包含结论、问题标签、条件必填意见、审核人、版本和源哈希" }], "/pet/intake?evidence=image", "前往诊疗图片人工审核");
    if (!petState.workflow.ontologyBuilt) { const main = `${petPageHeader("跨平台本体图谱", dataConnectionHeaderAction())}<section class="glass-panel ready-panel"><span class="status blue"><i></i>输入已就绪</span><h2>准备匹配跨平台身份并构建本体图谱</h2><p>系统优先使用芯片号和平台宠物编号，其次使用保单登记，最后使用宠物与主人组合信息进行匹配。</p><div class="path-flow ontology-build-flow"><span>材料事实</span><i>1</i><span>身份主键匹配</span><i>2</i><span>平台记录归类</span><i>3</i><span>本体关系</span></div>${button("匹配跨平台身份并构建本体图谱", "build-ontology", { primary: true, iconName: "nodes" })}</section>`; return { main, aside: `${contextTitle("本体图谱输入", "材料与人工审核结果已就绪")}${workflowStatus()}<div class="aside-group"><span class="aside-label">匹配优先级</span>${kv("优先", "芯片号 / 平台宠物编号")}${kv("其次", "保单与医院档案")}${kv("补充", "名称、品种、生日与联系方式")}</div><div class="aside-callout neutral"><strong>业务约束</strong><p>跨平台数据只形成事实与风险线索，不直接产生最终拒赔。</p></div>` }; }
    const claim = selectedClaim(), view = ontologyFocusView(claim), selectedRaw = view.focusNode, selectedRelationRaw = view.focusRelation, path = view.breadcrumb;
    const selected = { ...selectedRaw, nodeType: esc(selectedRaw.nodeType), label: esc(selectedRaw.label), localId: esc(selectedRaw.localId), platformLabel: esc(selectedRaw.platformLabel || ""), categoryLabel: esc(selectedRaw.categoryLabel || ""), platformType: esc(selectedRaw.platformType || ""), eventTime: esc(selectedRaw.eventTime || ""), summary: esc(selectedRaw.summary || "") };
    const selectedRelation = selectedRelationRaw ? { ...selectedRelationRaw, matchMethod: esc(selectedRelationRaw.matchMethod), evidence: esc(selectedRelationRaw.evidence), effectivePeriod: esc(selectedRelationRaw.effectivePeriod) } : null;
    const main = `${petPageHeader("跨平台本体图谱", dataConnectionHeaderAction())}
      <section class="glass-panel graph-panel ontology-panel ${petState.graphAnimating ? "graph-transitioning" : ""}"><div class="section-heading ontology-heading"><div><span class="eyebrow">FOCUS RELATION GRAPH</span><h2>${claim.petName} · ${view.root.localId}</h2><p>点击关联气泡切换中心，查看当前实体的一度上下游关系。</p></div><div class="graph-head-actions"><div class="graph-legend"><span><i class="insurance"></i>保险</span><span><i class="medical"></i>医疗</span><span><i class="payment"></i>支付</span><span><i class="registry"></i>档案</span><span><i class="other"></i>其他</span></div><div class="ontology-toolbar">${button("返回上级", "focus-parent", { disabled: !view.parentNode })}${button(`回到${view.root.label}`, "focus-root", { disabled: selected.id === view.root.id })}${button(petState.workflow.ontologyConfirmed ? "本体关系已确认" : "人工确认本体关系", "confirm-ontology", { primary: true, iconName: "check", disabled: petState.workflow.ontologyConfirmed })}</div></div></div><nav class="ontology-breadcrumb" aria-label="本体路径">${path.map((node, indexValue) => `<button data-action="focus-ontology-node" data-id="${node.id}" ${node.id === selected.id ? 'aria-current="page" disabled' : ""}>${esc(node.label)}</button>${indexValue < path.length - 1 ? "<i>/</i>" : ""}`).join("")}</nav><div class="ontology-focus-stage" aria-busy="${petState.graphAnimating}"><svg class="ontology-focus-graph" viewBox="0 0 ${view.width} ${view.height}" role="img" aria-label="${claim.petName}焦点关系图谱"><g class="ontology-line-layer">${view.relations.map(line => { const from = view.bubbles.find(node => node.id === line.from), to = view.bubbles.find(node => node.id === line.to), mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2; return `<g class="ontology-relation" data-line-id="${line.id}"><line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/><text x="${mx}" y="${my - 7}" text-anchor="middle">${esc(line.label)}</text></g>`; }).join("")}</g><g class="ontology-bubble-layer">${view.bubbles.map(renderBubble).join("")}</g></svg></div></section>
      <section class="glass-panel association-path"><div class="section-heading"><div><span class="eyebrow">ASSOCIATION EVIDENCE PATH</span><h2>关联证据路径</h2><p>从宠物主实体回溯到当前中心实体。</p></div>${selectedRelation ? ontologyStatus(selectedRelation.relationStatus) : '<span class="status blue"><i></i>主实体</span>'}</div><div class="association-route">${path.map((node, indexValue) => `${indexValue ? "<i>→</i>" : ""}<span><small>${node.nodeType}</small><strong>${esc(node.label)}</strong><code>${esc(node.localId)}</code></span>`).join("")}</div>${selectedRelation ? `<div class="association-evidence-grid"><div><span>匹配依据</span><strong>${selectedRelation.matchMethod}</strong></div><div><span>来源证据</span><strong>${selectedRelation.evidence}</strong></div><div><span>置信度</span><strong>${pct(selectedRelation.confidence * 100)}</strong></div><div><span>有效期</span><strong>${selectedRelation.effectivePeriod}</strong></div></div>` : '<p class="association-empty">选择任一平台气泡，即可查看完整关联证据。</p>'}</section>`;
    const aside = `${contextTitle(selected.nodeType, `${selected.label} · ${selected.localId}`)}${workflowStatus()}<div class="aside-group"><span class="aside-label">节点信息</span>${kv("节点类型", selected.nodeType)}${selected.platformLabel ? kv("所属平台", selected.platformLabel) : selected.level === "platform" ? kv("平台类型", selected.platformType) : ""}${selected.categoryLabel ? kv("数据类别", selected.categoryLabel) : ""}${kv("局部编号", `<code>${selected.localId}</code>`)}${selected.eventTime ? kv("记录时间", selected.eventTime) : ""}${selected.summary ? kv("摘要", selected.summary) : ""}</div>${selectedRelation ? `<div class="aside-group"><span class="aside-label">关联依据</span>${kv("匹配方式", selectedRelation.matchMethod)}${kv("关系状态", ontologyStatus(selectedRelation.relationStatus))}${kv("置信度", pct(selectedRelation.confidence * 100))}${kv("来源证据", selectedRelation.evidence)}${kv("有效期", selectedRelation.effectivePeriod)}</div>` : `<div class="aside-group"><span class="aside-label">跨平台覆盖</span>${kv("关联平台", `${view.root.platforms.length} 个`)}${kv("记录总量", `${view.root.platforms.reduce((sum, platform) => sum + platform.recordCount, 0)} 条`)}</div>`}<div class="aside-callout"><strong>使用边界</strong><p>医院、支付与家系数据只用于事实整合和风险提示，不直接产生最终拒赔。</p></div>${petState.workflow.ontologyConfirmed ? `<div class="aside-actions"><a class="button primary" href="#/pet/datasets">前往冻结FactSnapshot</a>${button("重新匹配平台数据", "rebuild-ontology")}</div>` : ""}`;
    return { main, aside };
  }

  function ontologyBubbleOpacity(node) { return node.bubbleRole === "focus" ? 1 : node.bubbleRole === "property" ? .28 : .34; }
  function ontologyFocusEase(progress) {
    const sample = (value, first, second) => 3 * (1 - value) * (1 - value) * value * first + 3 * (1 - value) * value * value * second + value * value * value;
    const slope = (value, first, second) => 3 * (1 - value) * (1 - value) * first + 6 * (1 - value) * value * (second - first) + 3 * value * value * (1 - second);
    let solved = progress;
    for (let indexValue = 0; indexValue < 5; indexValue++) { const difference = sample(solved, .22, .3) - progress, derivative = slope(solved, .22, .3); if (Math.abs(difference) < .0001 || Math.abs(derivative) < .0001) break; solved = Math.max(0, Math.min(1, solved - difference / derivative)); }
    return sample(solved, .8, 1);
  }
  function ensureOntologyMotionLayer(bubble) {
    let motion = [...bubble.children].find(child => child.classList?.contains("ontology-bubble-motion"));
    if (motion) return motion;
    motion = document.createElementNS("http://www.w3.org/2000/svg", "g"); motion.classList.add("ontology-bubble-motion");
    [...bubble.childNodes].forEach(node => motion.append(node)); bubble.append(motion); return motion;
  }
  function patchOntologyFocusDom(rendered) {
    const template = document.createElement("template"); template.innerHTML = rendered.main;
    const source = template.content, panel = document.querySelector(".ontology-panel"), stage = document.querySelector(".ontology-focus-stage"), toolbar = document.querySelector(".ontology-toolbar"), breadcrumb = document.querySelector(".ontology-breadcrumb"), association = document.querySelector(".association-path"), context = document.querySelector(".context-panel");
    const nextToolbar = source.querySelector(".ontology-toolbar"), nextBreadcrumb = source.querySelector(".ontology-breadcrumb"), nextStage = source.querySelector(".ontology-focus-stage"), nextAssociation = source.querySelector(".association-path"), nextSvg = nextStage?.querySelector(".ontology-focus-graph");
    if (!panel || !stage || !toolbar || !breadcrumb || !association || !context || !nextToolbar || !nextBreadcrumb || !nextAssociation || !nextSvg) return null;
    const scrollX = window.scrollX, scrollY = window.scrollY, main = document.querySelector("#main-content"), mainScrollTop = main?.scrollTop || 0;
    toolbar.innerHTML = nextToolbar.innerHTML; breadcrumb.innerHTML = nextBreadcrumb.innerHTML; stage.replaceChildren(nextSvg); association.innerHTML = nextAssociation.innerHTML; context.innerHTML = rendered.aside;
    if (main) main.scrollTop = mainScrollTop; window.scrollTo(scrollX, scrollY);
    return { panel, stage, svg: nextSvg };
  }

  async function transitionOntologyFocus(nextId) {
    if (petState.graphAnimating || nextId === petState.focusNodeId) return;
    const claim = selectedClaim(), index = ontologyIndex(claim); if (!index.nodeById.has(nextId)) return;
    const oldView = ontologyFocusView(claim), oldNodeById = new Map(oldView.bubbles.map(node => [node.id, node])), oldDomById = new Map([...document.querySelectorAll(".ontology-bubble[data-node-id]")].map(element => [element.dataset.nodeId, element.cloneNode(true)])), previousFocusId = petState.focusNodeId, reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    petState.focusNodeId = nextId; petState.graphAnimating = true;
    const newView = ontologyFocusView(claim), patched = patchOntologyFocusDom(renderPetGraph());
    if (!patched) { petState.focusNodeId = previousFocusId; petState.graphAnimating = false; return; }
    const { panel, stage, svg } = patched; panel.classList.add("graph-transitioning"); stage.setAttribute("aria-busy", "true");
    const newNodeById = new Map(newView.bubbles.map(node => [node.id, node])), clickedSource = oldNodeById.get(nextId) || oldView.focusNode, bubbleLayer = svg.querySelector(".ontology-bubble-layer"), exiting = [];
    oldView.bubbles.forEach(node => { if (newNodeById.has(node.id) || !bubbleLayer) return; const clone = oldDomById.get(node.id); if (!clone) return; clone.removeAttribute("data-node-id"); clone.removeAttribute("data-action"); clone.removeAttribute("data-id"); clone.removeAttribute("tabindex"); clone.setAttribute("role", "presentation"); clone.classList.add("exiting"); const motion = ensureOntologyMotionLayer(clone); clone.style.opacity = String(ontologyBubbleOpacity(node)); bubbleLayer.append(clone); exiting.push({ element: clone, motion, node, startOpacity: ontologyBubbleOpacity(node) }); });
    const states = [...svg.querySelectorAll(".ontology-bubble[data-node-id]")].map(element => { const target = newNodeById.get(element.dataset.nodeId), previous = oldNodeById.get(element.dataset.nodeId), source = previous || clickedSource, motion = ensureOntologyMotionLayer(element), startScale = (source?.radius || target.radius) / Math.max(1, target.radius), startOpacity = previous ? ontologyBubbleOpacity(previous) : 0, targetOpacity = ontologyBubbleOpacity(target), dx = (source?.x ?? newView.center.x) - target.x, dy = (source?.y ?? newView.center.y) - target.y; motion.setAttribute("transform", "translate(" + dx + " " + dy + ") scale(" + startScale + ")"); element.style.opacity = String(startOpacity); return { element, motion, target, dx, dy, startScale, startOpacity, targetOpacity }; });
    const relations = [...svg.querySelectorAll(".ontology-relation")]; relations.forEach(relation => { relation.style.opacity = "0"; });
    const finish = () => {
      states.forEach(state => { state.motion.removeAttribute("transform"); state.element.style.opacity = ""; });
      exiting.forEach(state => state.element.remove()); relations.forEach(relation => { relation.style.opacity = ""; });
      petState.graphAnimating = false; panel.classList.remove("graph-transitioning"); stage.setAttribute("aria-busy", "false"); svg.querySelector(".ontology-bubble.focus")?.focus();
    };
    if (reducedMotion) { finish(); return; }
    const duration = 2000, startedAt = performance.now();
    try {
      await new Promise(resolve => {
        const frame = now => {
          if (!stage.isConnected || !svg.isConnected) { resolve(); return; }
          const progress = Math.min(1, (now - startedAt) / duration), eased = ontologyFocusEase(progress);
          states.forEach(state => { const remaining = 1 - eased, scale = state.startScale + (1 - state.startScale) * eased, opacity = state.startOpacity + (state.targetOpacity - state.startOpacity) * eased; state.motion.setAttribute("transform", "translate(" + state.dx * remaining + " " + state.dy * remaining + ") scale(" + scale + ")"); state.element.style.opacity = String(opacity); });
          const exitProgress = Math.min(1, progress / .34), exitEase = ontologyFocusEase(exitProgress); exiting.forEach(state => { state.motion.setAttribute("transform", "scale(" + (1 - .18 * exitEase) + ")"); state.element.style.opacity = String(state.startOpacity * (1 - exitEase)); });
          const relationOpacity = .26 * eased * eased; relations.forEach(relation => { relation.style.opacity = String(relationOpacity); });
          if (progress < 1) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
    } finally { finish(); }
  }

  function ruleSelectOptions(values, current, placeholder = "") {
    const entries = Array.isArray(values) ? values : Object.entries(values), currentValues = Array.isArray(current) ? current.map(String) : [String(current)];
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : "") + entries.map(entry => {
      const value = Array.isArray(entry) ? entry[0] : entry, label = Array.isArray(entry) ? entry[1] : entry;
      return '<option value="' + esc(value) + '" ' + (currentValues.includes(String(value)) ? "selected" : "") + '>' + esc(label) + '</option>';
    }).join("");
  }
  function renderRuleValueEditor(condition) {
    const meta = RULE_FIELDS[condition.field], collection = ["IN", "NOT_IN"].includes(condition.operator), invalid = condition.value === "" || condition.value == null || condition.needsConfirmation;
    if (!meta || meta.valueType === "number") {
      const max = condition.field === "reimbursement_rate" ? 100 : 10000000;
      return '<input type="number" min="0" max="' + max + '" step="0.01" value="' + esc(condition.value) + '" data-rule-condition-value="' + esc(condition.id) + '" aria-label="条件阈值" aria-invalid="' + invalid + '">';
    }
    const options = meta.valueType === "boolean" ? [["true","是"],["false","否"]] : [["PASS","通过"],["FAIL","不通过"],["NEEDS_REVIEW","需要复核"]];
    if (collection) return '<select multiple size="' + options.length + '" data-rule-condition-value="' + esc(condition.id) + '" aria-label="集合值，按Ctrl或Command多选">' + ruleSelectOptions(options, condition.value) + '</select>';
    return '<select data-rule-condition-value="' + esc(condition.id) + '" aria-label="' + (meta.valueType === "boolean" ? "布尔值" : "图片审核结论") + '">' + ruleSelectOptions(options, condition.value, "请选择") + '</select>';
  }
  function readRuleEditorValue(input, meta, condition) {
    const collection = ["IN", "NOT_IN"].includes(condition.operator);
    if (meta.valueType === "number") return input.value === "" ? "" : Number(input.value);
    if (collection && input.multiple) return [...input.selectedOptions].map(option => meta.valueType === "boolean" ? option.value === "true" : option.value);
    if (meta.valueType === "boolean") return input.value === "true";
    return input.value;
  }  function renderRuleConditionEditor(condition, indexValue, logic) {
    const meta = RULE_FIELDS[condition.field] || RULE_FIELDS.covered_expense;
    return `<div class="rule-condition-row">
      <span class="condition-index">${String(indexValue + 1).padStart(2,"0")}</span>
      <select data-rule-condition-field="${esc(condition.id)}" aria-label="条件字段">${ruleSelectOptions(Object.entries(RULE_FIELDS).map(([key,value]) => [key,value.label]), condition.field)}</select>
      <select data-rule-condition-operator="${esc(condition.id)}" aria-label="比较运算符">${ruleSelectOptions(meta.operators, condition.operator, "运算符")}</select>
      <span class="condition-value">${renderRuleValueEditor(condition)}<small>${meta.unit === "CNY" ? "元" : meta.unit === "PERCENT" ? "%" : ""}</small></span>
      <button type="button" class="condition-remove" data-action="remove-rule-condition" data-id="${esc(condition.id)}" aria-label="删除条件">×</button>
      ${indexValue < petState.ruleDraft.conditions.length - 1 ? '<b class="condition-join">' + esc(logic) + '</b>' : ""}
    </div>`;
  }
  function renderRuleIssueList(issues) {
    if (!issues.length) return '<div class="compiler-clear"><i>✓</i><span><strong>语义完整</strong><small>可以确认保存并进入规则检查</small></span></div>';
    return `<div class="rule-issue-list">${issues.map(issue => `<div class="rule-issue ${issue.level.toLowerCase()}"><i>${issue.level === "BLOCKING" ? "!" : "·"}</i><span><strong>${esc(issue.message)}</strong><small>${esc(issue.suggestedFix)}</small></span><b>${issue.level === "BLOCKING" ? "阻断" : "提醒"}</b></div>`).join("")}</div>`;
  }
  function renderActionSelect(branch, dimension, current) {
    const labels = dimension === "coverageRecommendation" ? COVERAGE_ACTIONS : ROUTE_ACTIONS;
    const placeholder = branch === "elseActions" ? "请选择未命中动作" : "请选择命中动作";
    return `<select data-rule-action="${dimension}" data-rule-branch="${branch}">${ruleSelectOptions(labels, current, placeholder)}</select>`;
  }
  function renderRulePreview(rule, issues) {
    if (issues.some(issue => issue.level === "BLOCKING")) return '<div class="rule-preview-empty"><span>完成阻断项后生成确定性边界预览</span></div>';
    if (isStandardThresholdRule(rule)) {
      const threshold = candidateThreshold(rule), values = [...new Set([199, 200, 200.01, Number((threshold - .01).toFixed(2)), threshold, Number((threshold + .01).toFixed(2))])].filter(value => value >= 0).sort((a,b) => a-b);
      return `<div class="boundary-table rule-boundary"><div class="boundary-head"><span>可覆盖费用</span><span>现行 200元</span><span>候选 ${number(threshold)}元</span><span>执行分支</span></div>${values.map(value => {
        const claim = { ...petClaims[0], region: "上海", diseaseCode: "GASTROENTERITIS", coveredExpense: value }, oldDecision = decide(claim, BASELINE), newDecision = decideCandidateRule(claim, rule);
        return `<div><code>${money(value, value % 1 ? 2 : 0)}</code><span>${recommendation(oldDecision.coverageRecommendation)}</span><span>${recommendation(newDecision.coverageRecommendation)}</span><span class="branch-code">${newDecision.branch}</span></div>`;
      }).join("")}</div>`;
    }
    const samples = petClaims.slice(0, 6);
    return `<div class="rule-sample-table"><div class="sample-head"><span>样本案件</span><span>范围</span><span>条件命中</span><span>分支</span><span>输出</span></div>${samples.map(claim => {
      const decision = decideCandidateRule(claim, rule), matched = decision.conditionTrace.filter(trace => trace.matched).length;
      return `<div><span><strong>${claim.id}</strong><small>${claim.region} · ${claim.disease}</small></span><span>${decision.inScope ? "适用" : "范围外"}</span><span>${matched}/${rule.conditions.length}</span><code>${decision.branch}</code><span>${routeBadge(decision.processingRoute)}</span></div>`;
    }).join("")}</div>`;
  }
  function validationChecks(rule) {
    const issues = validateCandidateRule(rule), snapshotBound = petState.workflow.snapshotFrozen && rule.factSnapshotHash === snapshotHash(), checks = [
      { name: "FactSnapshot", detail: petState.workflow.snapshotFrozen ? `${snapshotId()} 已冻结` : "必须先冻结同一事实快照", level: petState.workflow.snapshotFrozen ? "pass" : "error" },
      { name: "快照绑定", detail: snapshotBound ? `候选规则已绑定 ${snapshotHash()}` : "候选规则与当前快照哈希不一致", level: snapshotBound ? "pass" : "error" },
      { name: "候选版本", detail: petState.workflow.candidateSaved ? `${rule.id} 已保存` : "必须先保存候选策略", level: petState.workflow.candidateSaved ? "pass" : "error" },
      { name: "解析器与结构", detail: `${RULE_PARSER_VERSION} · ${rule.conditions.length} 个条件 · 单层 ${rule.logic}`, level: "pass" },
      { name: "适用范围", detail: ruleScopeLabel(rule), level: RULE_REGIONS[rule.scope.region] && RULE_DISEASES[rule.scope.diseaseCode] ? "pass" : "error" },
      { name: "空值处理", detail: rule.onMissing === "REQUEST_MORE" ? "字段缺失进入补件路由" : rule.onMissing === "NO_MATCH" ? "字段缺失按未命中处理" : "空值策略未设置", level: ["REQUEST_MORE","NO_MATCH"].includes(rule.onMissing) ? "pass" : "error" },
      { name: "动作权限", detail: "保障建议与处理路由分离；不产生最终拒赔", level: issues.some(issue => ["EVIDENCE_PERMISSION", "EVIDENCE_AUTO_ROUTE", "FORBIDDEN_REJECT"].includes(issue.code)) ? "error" : "pass" },
    ];
    issues.forEach(issue => checks.push({ name: issue.message, detail: issue.suggestedFix, level: issue.level === "BLOCKING" ? "error" : "warn" }));
    return checks;
  }

  function operatorLabel(operator) {
    return ({ ">": "超过（不含）", ">=": "不少于（包含）", "<": "低于（不含）", "<=": "不高于（包含）", "=": "等于", "!=": "不等于", IN: "属于其中", NOT_IN: "不属于其中" })[operator] || "请选择比较方式";
  }
  function humanRuleSummary(rule) {
    const scope = `${RULE_REGIONS[rule?.scope?.region] || "待确认地区"}的${RULE_DISEASES[rule?.scope?.diseaseCode] || "待确认疾病"}案件`;
    const conditions = (rule?.conditions || []).map(condition => {
      const meta = RULE_FIELDS[condition.field], label = meta?.label || "待确认内容";
      const raw = Array.isArray(condition.value) ? condition.value.join("、") : condition.value;
      const value = meta?.unit === "CNY" ? `${raw}元` : meta?.unit === "PERCENT" ? `${raw}%` : meta?.valueType === "boolean" ? (raw === true || raw === "true" ? "是" : "否") : ({ PASS: "通过", FAIL: "不通过", NEEDS_REVIEW: "需要复核" }[raw] || raw || "待填写");
      return `${label}${operatorLabel(condition.operator)}${value}`;
    });
    const joiner = rule?.logic === "OR" ? "，任意一项满足" : "，并且";
    return `${scope}，当${conditions.join(joiner) || "判断条件待补充"}时，${actionSummary(rule?.thenActions || {})}；否则${actionSummary(rule?.elseActions || {})}。`;
  }
  function renderOpsConditionEditor(condition, indexValue) {
    const meta = RULE_FIELDS[condition.field] || RULE_FIELDS.covered_expense;
    const operatorOptions = meta.operators.map(operator => [operator, operatorLabel(operator)]);
    return `<div class="ops-condition-card">
      <div class="ops-condition-head"><strong>判断条件 ${indexValue + 1}</strong><button type="button" data-action="remove-rule-condition" data-id="${esc(condition.id)}" ${petState.ruleDraft.conditions.length === 1 ? "disabled" : ""}>删除</button></div>
      <div class="ops-condition-fields">
        <label><span>看什么数据</span><select data-rule-condition-field="${esc(condition.id)}">${ruleSelectOptions(Object.entries(RULE_FIELDS).map(([key,value]) => [key,value.label]), condition.field)}</select></label>
        <label><span>怎么比较</span><select data-rule-condition-operator="${esc(condition.id)}">${ruleSelectOptions(operatorOptions, condition.operator, "请选择")}</select></label>
        <label><span>比较值</span><span class="ops-value-editor">${renderRuleValueEditor(condition)}<small>${meta.unit === "CNY" ? "元" : meta.unit === "PERCENT" ? "%" : ""}</small></span></label>
      </div>
    </div>`;
  }
  function renderPetStrategies() {
    if (!petState.workflow.snapshotFrozen) return lockedView("宠物险理赔 / 策略实验", "策略实验", "候选策略必须绑定一份已冻结的FactSnapshot。", [{ label: "FactSnapshot已冻结", done: false, detail: "确保现行与候选读取完全相同的事实" }], "/pet/datasets", "前往数据快照");
    const draft = petState.ruleDraft, draftIssues = petState.ruleParsed ? validateCandidateRule(draft) : [], blocking = draftIssues.filter(issue => issue.level === "BLOCKING").length;
    const examples = strategyExamples(), parsed = petState.ruleParsed;
    const parseSource = draft.parseSource || "", modelReady = petState.modelSettings.configured;
    const main = `${petPageHeader("策略实验")}
      <div class="pet-strategy-page ops-strategy-page">
        <section class="rule-compiler ops-rule-compiler glass-panel">
          <article class="compiler-pane intent-pane">
            <div class="compiler-pane-head"><div><span class="eyebrow">规则描述</span><h2>告诉模型你想怎么调整</h2><p>按日常说话方式写清楚适用案件、判断条件和处理结果。</p></div></div>
            <div class="compiler-pane-body intent-editor-body">
              <label class="ops-field-label" for="rule-source-input">规则描述</label>
              <textarea id="rule-source-input" maxlength="1200" data-input="rule-source" aria-describedby="rule-intent-note" placeholder="例如：上海地区急性肠胃炎案件，可覆盖费用超过500元时给出不覆盖建议，否则给出覆盖建议；数据缺失时请求补件。">${esc(petState.ruleSource)}</textarea>
              <div class="ops-example-block"><span>不知道怎么写？点击示例带入</span><div>${examples.map((example,indexValue) => `<button type="button" data-action="use-rule-example" data-index="${indexValue}">示例 ${indexValue + 1}</button>`).join("")}</div></div>
              <div class="intent-privacy" id="rule-intent-note">${icon("shield",14)}<span>规则内容通过本地代理发送给已配置模型；API Key 不进入浏览器。</span></div>
              ${petState.modelParseError ? `<div class="model-parse-error" role="alert"><strong>这次没有解析成功</strong><p>${esc(petState.modelParseError)}</p><button type="button" class="button" data-action="parse-local-rule">暂用本地解析</button></div>` : ""}
            </div>
            <div class="compiler-pane-actions intent-actions"><button type="button" class="button" data-action="clear-rule-source">清空</button>${button(petState.ruleParsing ? "模型正在解析" : modelReady ? "模型解析" : "配置模型后解析", "parse-model-rule", { primary: true, iconName: petState.ruleParsing ? "refresh" : "sliders", disabled: petState.ruleParsing || !petState.ruleSource.trim() })}</div>
          </article>
          <article class="compiler-pane result-pane">
            <div class="compiler-pane-head"><div><span class="eyebrow">确认规则</span><h2>${parsed ? "请核对模型理解是否正确" : "等待模型解析"}</h2><p>${parsed ? "如有不对，可直接修改下面的中文选项。" : "点击左侧“模型解析”后，这里才会显示可确认的规则。"}</p></div>${parsed ? `<span class="status ${blocking ? "orange" : "success"}"><i></i>${blocking ? "需要修改" : "内容完整"}</span>` : ""}</div>
            <div class="compiler-pane-body result-editor-body">
              ${parsed ? `<div class="ops-rule-summary"><span>模型理解为</span><strong>${esc(humanRuleSummary(draft))}</strong></div>
                <div class="ops-rule-form">
                  <div class="ops-scope-fields"><label><span>适用地区</span><select data-rule-scope="region">${ruleSelectOptions(RULE_REGIONS,draft.scope.region,"请选择地区")}</select></label><label><span>适用疾病</span><select data-rule-scope="diseaseCode">${ruleSelectOptions(RULE_DISEASES,draft.scope.diseaseCode,"请选择疾病")}</select></label>${draft.conditions.length > 1 ? `<label><span>多个条件怎么判断</span><select data-rule-logic>${ruleSelectOptions([["AND","需要全部满足"],["OR","满足任意一个"]],draft.logic)}</select></label>` : ""}</div>
                  <div class="ops-condition-list">${draft.conditions.map(renderOpsConditionEditor).join("")}<button type="button" class="ops-add-condition" data-action="add-rule-condition">＋ 再加一个判断条件</button></div>
                  <div class="ops-result-grid"><div><strong>满足条件时</strong><label><span>保障建议</span>${renderActionSelect("thenActions","coverageRecommendation",draft.thenActions.coverageRecommendation)}</label><label><span>后续处理</span>${renderActionSelect("thenActions","processingRoute",draft.thenActions.processingRoute)}</label></div><div><strong>不满足条件时</strong><label><span>保障建议</span>${renderActionSelect("elseActions","coverageRecommendation",draft.elseActions.coverageRecommendation)}</label><label><span>后续处理</span>${renderActionSelect("elseActions","processingRoute",draft.elseActions.processingRoute)}</label></div></div>
                  <label class="ops-missing-field"><span>数据缺失时</span><select data-rule-missing>${ruleSelectOptions([["NO_MATCH","当作条件不满足"],["REQUEST_MORE","保留保障判断并请求补件"]],draft.onMissing,"请选择处理方式")}</select></label>
                </div>
                <div class="compiler-issues" data-rule-issue-list>${renderRuleIssueList(draftIssues)}</div>` : `<div class="parse-empty"><span class="test-state-icon">↳</span><strong>右侧现在没有复杂内容</strong><p>先在左侧写规则并点击“模型解析”，系统会把结果整理成容易核对的中文表单。</p></div>`}
            </div>
            <div class="compiler-pane-actions result-actions">${parsed ? button("确认规则并进入检查", "confirm-and-save-rule", { primary: true, iconName: "check", disabled: blocking > 0 }) : '<span class="ops-result-hint">模型解析后才能确认规则</span>'}</div>
          </article>
        </section>
        <details class="glass-panel technical-details">
          <summary><span>${icon("settings",16)}<strong>查看技术详情</strong><small>供专家或审计使用</small></span>${icon("arrow",15)}</summary>
          <div class="technical-details-body">
            <div class="tech-audit-grid">
              <article><span>现行规则</span><strong>可覆盖费用超过200元时给出不覆盖建议</strong><code>${BASELINE.id}</code></article>
              <article><span>当前候选差异</span><strong>${esc(candidateDelta(draft))}</strong><code>${esc(draft.id || CANDIDATE.id)}</code></article>
              <article><span>解析来源</span><strong>${parseSource === "MODEL" ? "模型解析" : parseSource === "LOCAL_FALLBACK" ? "本地备用解析" : "尚未解析"}</strong><code>${esc(petState.modelParseMeta?.requestId || "—")}</code></article>
              <article><span>FactSnapshot</span><strong>${esc(snapshotId())}</strong><code>${esc(snapshotHash())}</code></article>
            </div>
            <div class="tech-proof-grid"><article><div class="section-heading"><div><h3>边界与样本命中</h3></div></div><div data-rule-preview>${parsed ? renderRulePreview(draft,draftIssues) : '<div class="rule-preview-empty">解析后生成边界样本</div>'}</div></article><article><div class="section-heading"><div><h3>执行规则 DSL</h3></div></div><pre data-live-dsl>${esc(parsed ? compileRuleDsl(draft) : "解析后生成")}</pre></article></div>
            <div class="model-request-meta"><span>模型：${esc(petState.modelParseMeta?.model || "—")}</span><span>请求耗时：${petState.modelParseMeta?.latencyMs != null ? number(petState.modelParseMeta.latencyMs) + "ms" : "—"}</span><span>解析时间：${esc(petState.modelParseMeta?.parsedAt ? new Date(petState.modelParseMeta.parsedAt).toLocaleString("zh-CN",{hour12:false}) : "—")}</span></div>
          </div>
        </details>
      </div>`;
    const complete = parsed && blocking === 0;
    const aside = `${contextTitle("策略状态", modelReady ? "模型服务可用" : "模型服务尚未配置")}<div class="aside-group"><span class="aside-label">当前状态</span>${kv("模型", modelReady ? '<span class="status success"><i></i>可用</span>' : '<span class="status orange"><i></i>需配置</span>')}${kv("规则内容", complete ? "完整" : parsed ? "需要修改" : "等待解析")}${kv("人工确认", petState.workflow.candidateSaved ? "已确认" : "尚未确认")}</div>${!modelReady ? '<a class="button primary aside-wide-button" href="#/settings?return=/pet/strategies">前往模型设置</a>' : ""}<div class="aside-callout neutral"><strong>动作安全边界</strong><p>模型只整理规则。材料与图片事实只能进入人工复核或补件，不能直接产生最终拒赔。</p></div>`;
    return { main, aside };
  }

  function renderPetValidation() {
    const rule = petState.candidateRule, checks = validationChecks(rule), errors = checks.filter(check => check.level === "error").length;
    const main = `${petPageHeader("规则检查")}<section class="validation-overview glass-panel"><div class="validation-score"><strong>${errors ? Math.max(40,100-errors*12) : 100}</strong><span>规则健康度</span></div><div class="validation-copy"><span class="status ${errors ? "orange" : "success"}"><i></i>${errors ? "存在阻断" : "允许仿真"}</span><h2>${errors ? "修复规则语义后再运行" : "候选策略可进入离线双跑"}</h2><p>检查结构、字段、边界、空值、THEN / ELSE、动作权限和快照绑定。</p></div><div class="validation-actions"><a class="button" href="#/pet/strategies">返回策略实验</a>${button(petState.workflow.validationPassed ? "检查已确认" : "确认检查通过", "confirm-validation", { primary: true, iconName: "check", disabled: errors > 0 || petState.workflow.validationPassed })}</div></section><section class="glass-panel check-list">${checks.map((item,indexValue) => `<div class="check-row"><span class="check-index">${String(indexValue+1).padStart(2,"0")}</span><i class="check-icon ${item.level}">${item.level === "pass" ? "✓" : item.level === "warn" ? "!" : "×"}</i><div><strong>${esc(item.name)}</strong><p>${esc(item.detail)}</p></div><span class="status ${item.level === "pass" ? "success" : "orange"}"><i></i>${item.level === "pass" ? "通过" : item.level === "warn" ? "提醒" : "阻断"}</span></div>`).join("")}</section>`;
    const aside = `${contextTitle("检查上下文",errors ? "仍有阻断项" : "通用候选规则允许离线双跑")}${workflowStatus()}<div class="aside-group"><span class="aside-label">候选规则</span>${kv("版本",rule.id)}${kv("规则Hash","<code>" + candidateRuleHash(rule) + "</code>")}${kv("范围",esc(ruleScopeLabel(rule)))}${kv("条件",rule.conditions.length + " · " + rule.logic)}</div><div class="aside-callout neutral"><strong>医疗与合规边界</strong><p>本页只确认规则可进入SIMULATED回放；最终理赔结论仍需人工可追溯。</p></div>`;
    return { main, aside };
  }
  function filteredCases() { const f = petState.filters; return (petState.run?.rows || []).filter(row => !(f.transition === "CHANGED" && !row.changed) && (f.recommendation === "ALL" || row.newDecision.coverageRecommendation === f.recommendation) && (f.region === "ALL" || row.region === f.region) && (!f.search || `${row.id} ${row.policyId} ${row.petName}`.toLowerCase().includes(f.search.toLowerCase()))); }
  function traceValue(trace) {
    if (trace.missing) return "空值";
    const meta = RULE_FIELDS[trace.field], value = trace.actual;
    if (meta?.unit === "CNY") return money(Number(value), Number(value) % 1 ? 2 : 0);
    if (meta?.unit === "PERCENT") return number(Number(value), Number(value) % 1 ? 1 : 0) + "%";
    if (meta?.valueType === "boolean") return value ? "是" : "否";
    return String(value);
  }
  function renderCaseConditionTrace(row) {
    const trace = row.newDecision.conditionTrace || [];
    if (!trace.length) return '<section class="condition-trace"><div class="section-heading"><div><span class="eyebrow">EXECUTION TRACE</span><h3>条件执行轨迹</h3></div><span class="status neutral"><i></i>范围外</span></div><p class="trace-empty">案件不在候选策略范围内，直接沿用现行决策。</p></section>';
    return `<section class="condition-trace"><div class="section-heading"><div><span class="eyebrow">EXECUTION TRACE</span><h3>条件执行轨迹</h3></div><span class="status ${row.newDecision.branch === "THEN" ? "blue" : row.newDecision.branch === "MISSING" ? "orange" : "neutral"}"><i></i>${row.newDecision.branch}</span></div><div class="trace-list">${trace.map((item,indexValue) => `<div><span class="trace-index">${String(indexValue+1).padStart(2,"0")}</span><span><strong>${esc(item.label)}</strong><small>实际值 ${esc(traceValue(item))} · ${esc(item.operator)} · 期望 ${esc(item.expected)}</small></span><b class="${item.missing ? "missing" : item.matched ? "matched" : "unmatched"}">${item.missing ? "空值" : item.matched ? "命中" : "未命中"}</b></div>`).join("")}</div><p class="trace-policy">空值策略：${row.newDecision.branch === "MISSING" ? "请求补件" : row.newDecision.branch === "ELSE" ? "按未命中分支执行" : "未触发"}</p></section>`;
  }  function renderPetCases() {
    if (!petState.run) return lockedView("宠物险理赔 / 案例追踪", "受影响案例", "案例追踪只展示同一FactSnapshot上的baseline/challenger差异。", [{ label: "仿真结果已生成", done: false, detail: "先完成确定性双跑与差异计算" }], "/pet/simulation", "前往仿真总览");
    const rows = filteredCases(), pageSize = 15, pageCount = Math.max(1, Math.ceil(rows.length / pageSize)); petState.casePage = Math.min(petState.casePage, pageCount - 1); const pageRows = rows.slice(petState.casePage * pageSize, (petState.casePage + 1) * pageSize), selected = rows.find(row => row.id === petState.selectedClaimId) || pageRows[0] || petState.run.rows[0]; petState.selectedClaimId = selected.id;
    const main = `${petPageHeader("受影响案例")}
      <section class="glass-panel case-scope-summary"><span class="status blue"><i></i>当前迁移客群</span><strong>现行决策 → 候选决策</strong><p>${esc(ruleSummary(petState.run.candidate))}</p><a class="button" href="#/pet/simulation">返回仿真总览</a></section>
      <section class="glass-panel case-filter-bar"><label>${icon("search",17)}<input placeholder="搜索案件、保单或宠物" value="${esc(petState.filters.search)}" data-input="case-search"></label><select data-input="case-transition"><option value="CHANGED" ${petState.filters.transition === "CHANGED" ? "selected" : ""}>只看发生迁移</option><option value="ALL" ${petState.filters.transition === "ALL" ? "selected" : ""}>全部案件</option></select><span>${rows.length} 笔</span></section>
      <div class="case-workspace"><section class="glass-panel case-table"><div class="table-header"><span>案件 / 宠物</span><span>可覆盖费用</span><span>赔付变化</span><span>处理路由</span><span>证据状态</span></div>${pageRows.map(row => { const evidenceReady = row.materialComplete && row.imageCompliance === "PASS"; return `<button class="case-row ${row.id === selected.id ? "selected" : ""}" data-action="select-case" data-id="${row.id}"><span><strong>${row.id}</strong><small>${row.petName} · ${row.policyId}</small></span><strong>${money(row.coveredExpense,2)}</strong><strong class="delta-positive">${signed(row.newDecision.payableAmount - row.oldDecision.payableAmount, value => money(value, 2))}</strong><span>${routeBadge(row.newDecision.processingRoute)}</span><span class="status ${evidenceReady ? "success" : "orange"}"><i></i>${evidenceReady ? "证据完整" : "需复核"}</span></button>`; }).join("") || '<div class="empty-state"><strong>没有匹配案件</strong><p>调整筛选条件后重试。</p></div>'}<div class="case-pagination"><button class="button" data-action="case-prev" ${petState.casePage === 0 ? "disabled" : ""}>上一页</button><span>第 ${petState.casePage + 1} / ${pageCount} 页</span><button class="button" data-action="case-next" ${petState.casePage >= pageCount - 1 ? "disabled" : ""}>下一页</button></div></section><section class="glass-panel case-detail"><div class="claim-summary"><div><span class="eyebrow">理赔单号：${selected.id}</span><h2>${selected.petName} · ${selected.disease}</h2><p>保单号：${selected.policyId} · ${selected.hospital}</p></div>${selected.changed ? '<span class="status purple"><i></i>决策迁移</span>' : '<span class="status neutral"><i></i>决策不变</span>'}</div><div class="decision-compare"><div><span>现行 ${BASELINE.version}</span>${recommendation(selected.oldDecision.coverageRecommendation)}<strong>${money(selected.oldDecision.payableAmount,2)}</strong><p>${selected.oldDecision.explanation}</p></div><i>→</i><div><span>候选 ${petState.run.candidate.version}</span>${recommendation(selected.newDecision.coverageRecommendation)}<strong>${money(selected.newDecision.payableAmount,2)}</strong><p>${selected.newDecision.explanation}</p></div></div>${renderCaseConditionTrace(selected)}<div class="amount-calculation"><span class="eyebrow">PAYABLE AMOUNT</span><h3>金额计算</h3><code>min(${money(selected.remainingLimit)}, max(0, ${money(selected.coveredExpense,2)} − ${money(selected.deductible)}) × ${pct(selected.reimbursementRate*100,0)})</code><strong>= ${money(selected.newDecision.payableAmount,2)}</strong></div><div class="line-items"><div><span>费用明细</span><b>是否纳入</b><strong>金额</strong></div>${selected.lineItems.map(item => `<div><span>${item.name}</span><b>${item.eligible ? "覆盖" : "不覆盖"}</b><strong>${money(item.amount,2)}</strong></div>`).join("")}</div></section></div>`;
    const aside = `${contextTitle("证据与路径", selected.id)}<div class="aside-group"><span class="aside-label">当前判断</span>${kv("规则命中", `<code>${selected.newDecision.ruleHit}</code>`)}${kv("执行分支", `<code>${selected.newDecision.branch}</code>`)}${kv("处理路由", routeBadge(selected.newDecision.processingRoute))}${kv("证据状态", selected.materialComplete && selected.imageCompliance === "PASS" ? "完整" : "需要复核")}</div><div class="aside-group"><span class="aside-label">来源证据</span>${evidenceFor(selected).slice(0,4).map(item => `<a class="evidence-link" href="#/pet/intake?claim=${selected.id}"><span>${item.type}</span><b>${pct(item.confidence*100)}</b>${icon("arrow",14)}</a>`).join("")}</div><div class="aside-callout"><strong>关联证据路径</strong><p>宠物主实体 → 大西洋保险 → 当前理赔 → 本案证据；路径版本 ${SNAPSHOT.ontology}。</p><a class="text-link" href="#/pet/graph">查看本体图谱</a></div>`;
    return { main, aside };
  }

  function renderCreditPage(route) { if (route.path === "/credit/strategies") return renderCreditStrategies(); if (route.path === "/credit/validation") return renderCreditValidation(); if (route.path === "/credit/simulation") return renderCreditSimulation(); if (route.path === "/credit/cases") return renderCreditCases(); return renderCreditDatasets(); }
  function renderCreditDatasets() { const main = `${pageHeader("信贷准入 / 数据", "历史申请数据集", "保留原信贷解决方案，用于演示通用策略仿真内核。")}<section class="dataset-grid"><article class="dataset-card selected"><span class="dataset-status"><i></i>当前数据集</span><h3>个人消费贷历史申请 · 2025上半年</h3><p>1,200 笔模拟申请 · 固定随机种子</p><div class="dataset-metrics"><span><b>98.4%</b>字段覆盖</span><span><b>94.8%</b>结果成熟</span></div></article><article class="dataset-card"><span class="dataset-status"><i></i>可用</span><h3>个人消费贷历史申请 · 2024下半年</h3><p>1,080 笔模拟申请</p><div class="dataset-metrics"><span><b>96.9%</b>字段覆盖</span><span><b>100%</b>结果成熟</span></div></article></section>`; return { main, aside: `${contextTitle("信贷数据", "离线模拟数据")}${kv("当前产品", "个人消费贷")}${kv("样本量", "1,200")}${kv("观察期", "6个月")}` }; }
  function creditField(label, name, value, unit) { return `<label class="compact-field"><span>${label}</span><span><input type="number" value="${value}" data-credit-field="${name}"><b>${unit}</b></span></label>`; }
  function renderCreditStrategies() { const r = creditState.draft, main = `${pageHeader("信贷准入 / 策略", "候选规则阈值", "现行 v1.6 与候选 v1.7-draft 进行确定性回放。", button("保存候选策略", "save-credit-strategy", { primary: true }))}<section class="strategy-compare"><article class="strategy-card baseline"><span class="status neutral"><i></i>现行 v1.6</span><h2>当前准入策略</h2>${kv("近12月逾期", `≥ ${CREDIT_BASE.overdueCount}次拒绝`)}${kv("最大逾期", `> ${CREDIT_BASE.maxOverdueDays}天拒绝`)}${kv("负债收入比", `> ${CREDIT_BASE.dtiPercent}%人审`)}</article><article class="strategy-card candidate"><span class="status blue"><i></i>候选 v1.7-draft</span><h2>编辑候选阈值</h2>${creditField("近12月逾期次数", "overdueCount", r.overdueCount, "次")}${creditField("最大逾期天数", "maxOverdueDays", r.maxOverdueDays, "天")}${creditField("负债收入比", "dtiPercent", r.dtiPercent, "%")}</article></section>`; return { main, aside: `${contextTitle("候选策略", "v1.7-draft")}${kv("逾期次数", r.overdueCount)}${kv("最大逾期天数", r.maxOverdueDays)}${kv("负债收入比", `${r.dtiPercent}%`)}` }; }
  function renderCreditValidation() { const checks = [["字段完整性", "规则字段均已映射"], ["阈值冲突", "拒绝与人审动作无冲突"], ["空值策略", "DTI缺失进入人工审核"], ["时间穿越", "未引用申请时点之后字段"]], main = `${pageHeader("信贷准入 / 检查", "规则检查", `候选策略 ${creditState.rules.version} 当前允许仿真。`, '<a class="button primary" href="#/credit/simulation">查看仿真</a>')}<section class="glass-panel check-list">${checks.map((item,i) => `<div class="check-row"><span class="check-index">0${i+1}</span><i class="check-icon pass">✓</i><div><strong>${item[0]}</strong><p>${item[1]}</p></div><span class="status success"><i></i>通过</span></div>`).join("")}</section>`; return { main, aside: `${contextTitle("检查结果", "4项通过")}<div class="run-health"><span class="health-ring"><b>100</b><small>健康度</small></span></div>` }; }
  function renderCreditSimulation() { const r = creditState.run, main = `${pageHeader("信贷准入 / 仿真", "现行与候选策略对比", "对同一批历史申请执行两套确定性准入规则。", button("重新运行", "run-credit-simulation", { primary: true, iconName: "play" }))}<section class="kpi-grid three">${kpi("通过", r.next.PASS, signed(r.next.PASS-r.old.PASS), "OBSERVED_REPLAY", "credit")}${kpi("人工审核", r.next.REVIEW, signed(r.next.REVIEW-r.old.REVIEW), "OBSERVED_REPLAY", "credit")}${kpi("拒绝", r.next.REJECT, signed(r.next.REJECT-r.old.REJECT), "OBSERVED_REPLAY", "credit")}</section><section class="glass-panel"><div class="section-heading"><div><span class="eyebrow">DECISION COMPARISON</span><h2>处置结果对比</h2><p>${r.changed} 笔申请发生迁移</p></div></div><div class="credit-bars">${["PASS","REVIEW","REJECT"].map(key => `<div><span>${{PASS:"通过",REVIEW:"人工审核",REJECT:"拒绝"}[key]}</span><i><b class="old" style="width:${r.old[key]/12}%"></b></i><em>${r.old[key]}</em><i><b class="next" style="width:${r.next[key]/12}%"></b></i><em>${r.next[key]}</em></div>`).join("")}</div></section>`; return { main, aside: `${contextTitle("信贷仿真", "现行 v1.6 / 候选 v1.7")}${kv("样本量", "1,200")}${kv("决策变化", r.changed)}${kv("运行模式", "离线确定性回放")}` }; }
  function renderCreditCases() { const rows = creditState.run.rows.filter(r => r.oldDecision !== r.newDecision).slice(0,40), main = `${pageHeader("信贷准入 / 案例", "迁移案例下钻", "查看新旧规则导致的申请决策变化。")}<section class="glass-panel case-table"><div class="table-header credit"><span>申请编号</span><span>信用分</span><span>逾期次数</span><span>现行</span><span>候选</span></div>${rows.map(r => `<div class="case-row credit"><strong>${r.id}</strong><span>${r.creditScore}</span><span>${r.overdueCount}</span><span class="status neutral"><i></i>${r.oldDecision}</span><span class="status blue"><i></i>${r.newDecision}</span></div>`).join("")}</section>`; return { main, aside: `${contextTitle("迁移客群", `${rows.length}笔展示`)}${kv("筛选", "决策发生变化")}${kv("数据", "模拟申请")}` }; }

  function toast(message) { toastRegion.innerHTML = `<div class="toast">${icon("check",17)}<span>${esc(message)}</span></div>`; setTimeout(() => { toastRegion.innerHTML = ""; }, 2600); }
  function invalidateAfterEvidence() { Object.assign(petState.workflow, { imageReviewComplete: false, idMatched: false, ontologyBuilt: false, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null }); petState.run = null; petState.focusNodeId = "pet-master"; petState.graphAnimating = false; removeStore(STORE.petRun); persistWorkflow(); }
  function invalidateAfterReview() { Object.assign(petState.workflow, { imageReviewComplete: false, idMatched: false, ontologyBuilt: false, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null }); petState.run = null; petState.focusNodeId = "pet-master"; petState.graphAnimating = false; removeStore(STORE.petRun); persistWorkflow(); }
  function strategyExamples() {
    return [
      "上海地区急性肠胃炎案件，当可覆盖费用超过500元时给出不覆盖建议，否则给出覆盖建议；字段缺失时请求补件。",
      "全部地区急性肠胃炎案件，当剩余额度低于2000元并且赔付比例大于80%时进入人工复核，否则沿用现行路由；字段缺失按未命中处理。",
      "上海地区所有病种案件，当材料不完整或者图片审核需复核时请求补件，否则沿用现行路由；字段缺失时请求补件。",
    ];
  }
  function invalidateAfterCandidateChange() {
    petState.workflow.candidateSaved = false; petState.workflow.validationPassed = false; petState.run = null;
    removeStore(STORE.petRun); persistWorkflow();
  }
  async function parseRuleWithModel() {
    if (!petState.ruleSource.trim()) return toast("请先写下要调整的规则");
    if (!petState.modelSettings.configured) { petState.settingsReturnPath = "/pet/strategies"; location.hash = "#/settings?return=/pet/strategies"; return; }
    const source = petState.ruleSource, requestId = ++petState.parseRequestId;
    petState.ruleParsing = true; petState.ruleParsed = false; petState.modelParseError = ""; render();
    try {
      const payload = await apiRequest("/api/rules/parse", { method: "POST", body: JSON.stringify({ sourceText: source, experimentRevision: petState.experimentRevision, factSnapshotHash: snapshotHash(), factSchemaVersion: FACT_SCHEMA_VERSION }) });
      if (requestId !== petState.parseRequestId) return;
      const data = payload.data || {}, rule = sanitizeCandidateRule(data.rule, 500);
      Object.assign(rule, { sourceText: source, parseSource: "MODEL", parserVersion: data.parserVersion || MODEL_PARSER_VERSION, modelName: data.modelName || "", modelRequestId: data.requestId || "", modelParsedAt: new Date().toISOString(), warnings: data.issues || [] });
      petState.ruleDraft = rule;
      petState.ruleParsed = true; petState.ruleDraftConfirmed = false; petState.ruleParsing = false;
      petState.modelParseMeta = { requestId: data.requestId, model: data.modelName || "", latencyMs: data.latencyMs, parsedAt: rule.modelParsedAt };
      render();
      const issues = validateCandidateRule(rule), blocking = issues.filter(issue => issue.level === "BLOCKING").length;
      toast(blocking ? `模型已解析，请按提示修改${blocking}处内容` : "模型已解析，请核对右侧规则");
    } catch (error) {
      if (requestId !== petState.parseRequestId) return;
      petState.ruleParsing = false; petState.ruleParsed = false; petState.modelParseError = error.message; render();
    }
  }
  async function parseRuleLocally() {
    if (!petState.ruleSource.trim()) return toast("请先写下要调整的规则");
    const requestId = ++petState.parseRequestId;
    petState.ruleParsing = true; petState.ruleParsed = false; render();
    try {
      const payload = await apiRequest("/api/rules/parse-local", { method: "POST", body: JSON.stringify({ sourceText: petState.ruleSource, experimentRevision: petState.experimentRevision }) });
      if (requestId !== petState.parseRequestId) return;
      const data = payload.data || {}, rule = sanitizeCandidateRule(data.rule, 500);
      Object.assign(rule, { parseSource: "LOCAL_FALLBACK", parserVersion: data.parserVersion || RULE_PARSER_VERSION, modelName: "", modelRequestId: data.requestId || "", modelParsedAt: new Date().toISOString(), warnings: data.issues || [] });
      petState.ruleDraft = rule; petState.ruleParsed = true; petState.ruleParsing = false; petState.ruleDraftConfirmed = false; petState.modelParseError = "";
      petState.modelParseMeta = { requestId: data.requestId || "", model: "本地备用解析器", latencyMs: 0, parsedAt: rule.modelParsedAt };
      render(); toast("已使用后端本地解析，请核对右侧规则");
    } catch (error) {
      if (requestId !== petState.parseRequestId) return;
      petState.ruleParsing = false; petState.modelParseError = error.message; render();
    }
  }
  function markRuleDraftChanged(flagsToClear = []) {
    petState.ruleDraft.parserFlags = (petState.ruleDraft.parserFlags || []).filter(flag => !flagsToClear.includes(flag));
    petState.ruleParsed = true; petState.ruleDraftConfirmed = false;
  }
  function refreshRuleDraftFeedback() {
    const issues = validateCandidateRule(petState.ruleDraft), blocking = issues.filter(issue => issue.level === "BLOCKING").length;
    const issueList = document.querySelector("[data-rule-issue-list]"); if (issueList) issueList.innerHTML = renderRuleIssueList(issues);
    const dsl = document.querySelector("[data-live-dsl]"); if (dsl) dsl.textContent = compileRuleDsl(petState.ruleDraft);
    const preview = document.querySelector("[data-rule-preview]"); if (preview) preview.innerHTML = renderRulePreview(petState.ruleDraft, issues);
    const status = document.querySelector(".result-pane .compiler-pane-head > .status");
    if (status) { status.className = "status " + (blocking ? "orange" : "success"); status.innerHTML = "<i></i>" + (blocking ? blocking + "项阻断" : "可确认"); }
    const confirmButton = document.querySelector('[data-action="confirm-and-save-rule"]'); if (confirmButton) confirmButton.disabled = blocking > 0 || !petState.ruleParsed;
    const live = document.querySelector("[data-rule-live-status]"); if (live) live.textContent = blocking ? "规则预览已更新，存在" + blocking + "项阻断" : "规则预览已更新，可以确认";
  }  function addRuleCondition() {
    if (petState.ruleDraft.conditions.length >= 8) return toast("单条规则最多支持8个条件");
    const id = "condition-" + (Date.now().toString(36)), meta = RULE_FIELDS.covered_expense;
    petState.ruleDraft.conditions.push({ id, field: "covered_expense", operator: ">", value: "", valueType: meta.valueType, unit: meta.unit, needsConfirmation: false });
    markRuleDraftChanged(); render();
  }
  function removeRuleCondition(id) {
    petState.ruleDraft.conditions = petState.ruleDraft.conditions.filter(condition => condition.id !== id);
    markRuleDraftChanged(); render();
  }
  async function confirmAndSaveRuleDraft() {
    if (!petState.workflow.snapshotFrozen) return toast("请先冻结FactSnapshot");
    const issues = validateCandidateRule(petState.ruleDraft), blocking = issues.filter(issue => issue.level === "BLOCKING");
    if (blocking.length) { document.querySelector('[aria-invalid="true"]')?.focus(); return toast(blocking[0].message); }
    try {
      const confirmed = sanitizeCandidateRule({ ...petState.ruleDraft, sourceText: petState.ruleSource, factSnapshotHash: snapshotHash(), confirmedAt: new Date().toISOString() }, 500);
      const payload = await apiRequest("/api/strategies", { method: "POST", body: JSON.stringify({ experimentRevision: petState.experimentRevision, rule: confirmed, sourceText: petState.ruleSource, parseSource: confirmed.parseSource, parserVersion: confirmed.parserVersion, modelName: confirmed.modelName, modelRequestId: confirmed.modelRequestId, humanAmendments: [] }) });
      const data = payload.data || {};
      petState.experimentRevision = data.experimentRevision;
      petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
      petState.backendValidation = data.validation || null;
      petState.activeStrategyId = data.strategy?.strategyId || null;
      petState.candidateRule = sanitizeCandidateRule(data.strategy || confirmed, 500);
      petState.ruleDraft = cloneRule(petState.candidateRule);
      petState.ruleDraftConfirmed = true; petState.run = null;
      location.hash = "#/pet/validation";
      render(); toast(`候选规则 ${petState.candidateRule.id} 已保存，请完成规则检查`);
    } catch (error) { toast(error.message); }
  }
  async function runPetSimulation() {
    const workflow = petState.workflow, issues = validateCandidateRule(petState.candidateRule);
    if (!(workflow.snapshotFrozen && workflow.candidateSaved && workflow.validationPassed)) return toast("请先完成快照冻结、策略保存和规则检查");
    if (issues.some(issue => issue.level === "BLOCKING")) return toast("候选规则存在阻断问题");
    petState.running = true; render();
    try {
      const payload = await apiRequest("/api/simulations", { method: "POST", body: JSON.stringify({ experimentRevision: petState.experimentRevision }) });
      const data = payload.data || {};
      petState.experimentRevision = data.experimentRevision;
      petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
      petState.run = normalizeBackendRun(data.run); petState.running = false;
      location.hash = "#/pet/simulation"; render(); toast(`仿真完成：${petState.run.changedRows.length}笔案件发生迁移`);
    } catch (error) { petState.running = false; render(); toast(error.message); }
  }
  function diagnosticEvidenceId(claim) { return `EV-${String(petClaims.findIndex(item => item.id === claim.id) + 1).padStart(4, "0")}-diagnostic_image`; }
  async function saveReview() {
    const claim = selectedClaim(), selected = evidenceFor(claim).find(item => item.id === petState.selectedEvidenceId);
    if (!selected || selected.type !== "诊疗图片") return toast("只有诊疗图片需要保存人工审核结果");
    const key = `${claim.id}:${selected.id}`, review = mergedReview(claim, selected.id), errors = reviewErrors(review);
    if (errors.length) return toast(errors[0]);
    const tag = reviewTag(review.tagCode);
    try {
      const payload = await apiRequest(`/api/evidence/${encodeURIComponent(selected.backendEvidenceId || selected.id.startsWith("EV-") && selected.id || diagnosticEvidenceId(claim))}/image-reviews`, { method: "POST", body: JSON.stringify({ experimentRevision: petState.experimentRevision, status: review.status, tagCode: tag.code, tagLabel: tag.label, comment: String(review.comment || "").trim(), reviewer: "演示审核员" }) });
      const data = payload.data || {};
      petState.experimentRevision = data.experimentRevision; petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
      petState.reviews[key] = { ...data.review, reviewedAt: data.review?.createdAt };
      delete petState.reviewDraft[key]; render(); toast("人工审核结果已保存；下游本体图谱与快照已失效");
    } catch (error) { toast(error.message); }
  }
  function updateReviewValidationUi() { const claim = selectedClaim(), review = mergedReview(claim, petState.selectedEvidenceId), errors = reviewErrors(review), box = document.querySelector("[data-review-validation]"), saveButton = document.querySelector('[data-action="save-image-review"]'); if (box) { box.className = `review-validation ${errors.length ? "error" : "success"}`; box.replaceChildren(...(errors.length ? errors : ["人工审核信息完整，可以保存"]).map(message => { const span = document.createElement("span"); span.textContent = message; return span; })); } if (saveButton) saveButton.disabled = errors.length > 0; }
  function exportReport() {
    if (!petState.run) return toast("请先运行仿真");
    const run = petState.run, report = `Strategy Sandbox 宠物险策略仿真摘要\n\n仿真ID：${run.id}\nFactSnapshot：${snapshotId()}\n现行规则：${BASELINE.id}\n候选规则：${run.candidate.id}\n规则Hash：${run.ruleHash}\n适用范围：${ruleScopeLabel(run.candidate)}\n条件：${run.candidate.conditions.map(conditionLabel).join(" " + run.candidate.logic + " ")}\n受影响案件：${run.changedRows.length}\n保障建议变化：${run.coverageChangedCount}\n处理路由变化：${run.routeChangedCount}\n赔付金额变化：${money(run.payoutDelta,2)}\n人工工时变化：${run.workHoursDelta}h\n\nDSL\n${compileRuleDsl(run.candidate)}\n\n声明：历史回放及估算结果不代表真实未来理赔结果。`;
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = run.id + ".txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); toast("仿真摘要已导出");
  }
  async function handleUpload(file) {
    if (!file) return;
    const claim = selectedClaim(), type = /invoice|发票/i.test(file.name) ? "费用发票" : /record|病例|病历/i.test(file.name) ? "病历扫描件" : /pdf/i.test(file.type) ? "PDF材料" : "诊疗图片";
    const evidenceType = type === "诊疗图片" ? "diagnostic_image" : type === "费用发票" ? "invoice" : type === "病历扫描件" ? "medical_record" : "lab_report";
    const form = new FormData(); form.append("file", file); form.append("evidenceType", evidenceType); form.append("experimentRevision", String(petState.experimentRevision));
    try {
      const payload = await apiRequest(`/api/claims/${encodeURIComponent(claim.id)}/evidence`, { method: "POST", body: form });
      const data = payload.data || {}, item = data.evidence, isDiagnosticImage = evidenceType === "diagnostic_image";
      petState.sessionUploads.push({ id: item.id, backendEvidenceId: item.id, claimId: claim.id, name: item.fileName, type, size: item.sizeBytes, addedAt: item.createdAt, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "./assets/pet-demo/medical-record.svg", confidence: item.confidence, result: isDiagnosticImage ? "等待人工审核" : `${type} · 后端演示识别完成`, fact: isDiagnosticImage ? "ImageReviewResult" : "Evidence/UPLOADED" });
      petState.selectedEvidenceId = item.id;
      await loadBackendState(false); render();
      toast(isDiagnosticImage ? "诊疗图片已登记；请完成人工结论、问题标签和审核意见" : "新文本材料已登记；请重新确认识别结果，原下游快照已失效");
    } catch (error) { toast(error.message); }
  }

  function connectionSelect(label, name, value, options) {
    return '<label class="connection-field"><span>' + esc(label) + '</span><select data-connection-field="' + esc(name) + '">' + options.map(item => '<option value="' + esc(item[0]) + '" ' + (item[0] === value ? "selected" : "") + '>' + esc(item[1]) + '</option>').join("") + '</select></label>';
  }

  function connectionField(label, name, value, type = "text", placeholder = "", attrs = "") {
    return '<label class="connection-field"><span>' + esc(label) + '</span><input type="' + type + '" data-connection-field="' + esc(name) + '" value="' + esc(value || "") + '" placeholder="' + esc(placeholder) + '" ' + attrs + '></label>';
  }

  function renderConnectionForm(draft) {
    const common = [
      connectionField(draft.sourceKind === "database" ? "接入名称" : "平台名称", "name", draft.name, "text", draft.sourceKind === "database" ? "例如：区域医院数据仓库" : "例如：萌爪健康平台", 'maxlength="40"'),
      connectionSelect("业务类型", "businessType", draft.businessType, Object.entries(CONNECTION_BUSINESS).map(item => [item[0], item[1].label])),
      connectionSelect("身份匹配主键", "matchKey", draft.matchKey, Object.entries(CONNECTION_MATCH_KEYS).map(item => [item[0], item[1]])),
    ];
    if (draft.sourceKind === "database") {
      common.push(
        connectionSelect("数据库类型", "connectorType", draft.connectorType, [["MySQL", "MySQL"], ["PostgreSQL", "PostgreSQL"], ["SQL Server", "SQL Server"]]),
        connectionField("主机", "host", draft.host, "text", "db.internal.example", 'autocomplete="off"'),
        connectionField("端口", "port", draft.port, "number", "5432", 'min="1" max="65535" inputmode="numeric"'),
        connectionField("数据库", "database", draft.database, "text", "pet_his"),
        connectionField("Schema", "schema", draft.schema, "text", "public"),
        connectionField("用户名", "username", draft.username, "text", "sandbox_reader", 'autocomplete="off"'),
        connectionField("密码", "secret", draft.secret, "password", "仅本次测试使用", 'autocomplete="new-password"')
      );
    } else {
      common.push(
        connectionSelect("接入协议", "connectorType", draft.connectorType, [["REST API", "REST API"], ["SFTP", "SFTP"], ["Webhook", "Webhook"]]),
        connectionField("服务地址", "endpoint", draft.endpoint, "url", draft.connectorType === "SFTP" ? "sftp://files.example.com/inbox" : "https://api.example.com/v1", 'autocomplete="off"'),
        connectionSelect("认证方式", "authType", draft.authType, [["Token", "Token"]]),
        connectionField("App ID", "appId", draft.appId, "text", "pet-sandbox-client", 'autocomplete="off"'),
        connectionField("Token", "secret", draft.secret, "password", "仅本次测试使用", 'autocomplete="new-password"')
      );
    }
    return common.join("");
  }

  function renderConnectionTestPanel(draft) {
    const test = petState.connectionTest;
    if (petState.connectionTesting) return '<div class="connection-test-state testing"><span class="test-state-icon">' + icon("refresh", 20) + '</span><strong>正在模拟连接与发现数据</strong><p>本地确定性演示，不会访问外部网络。</p></div>';
    if (!test) return '<div class="connection-test-state empty"><span class="test-state-icon">' + icon("database", 20) + '</span><strong>等待连接测试</strong><p>填写配置后执行测试，系统将展示发现的数据类别和记录量。</p></div>';
    if (!test.ok) return '<div class="connection-test-state failed"><span class="test-state-icon">!</span><strong>连接测试未通过</strong><p>' + esc(test.message) + '</p></div>';
    const preview = test.preview;
    return '<div class="connection-test-state success"><span class="status success"><i></i>连接测试通过</span><h3>发现 ' + preview.categories.length + ' 个数据类别</h3><div class="connection-category-preview">' + preview.categories.map(item => '<span><strong>' + esc(item.label) + '</strong><small>' + item.count + ' 条</small></span>').join("") + '</div><div class="connection-preview-meta"><span>记录量<strong>' + preview.recordCount + '</strong></span><span>数据版本<strong>' + esc(preview.dataVersion) + '</strong></span><span>同步时间<strong>' + esc(preview.syncedAt) + '</strong></span><span>身份匹配<strong>' + esc(preview.matchMethod) + '</strong></span></div></div>';
  }

  function renderConnectedSources() {
    if (!petState.connections.length) return '<div class="connected-empty">尚未接入外部数据源</div>';
    return petState.connections.map(connection => {
      const business = CONNECTION_BUSINESS[connection.businessType] || CONNECTION_BUSINESS.other;
      return '<article class="connected-source"><span class="source-kind ' + esc(business.kind) + '">' + icon(connection.sourceKind === "database" ? "database" : "nodes", 17) + '</span><div><strong>' + esc(connection.name) + '</strong><small>' + esc(connection.connectorType) + ' · ' + esc(connection.endpointMasked) + '</small></div><span class="status success"><i></i>已连接</span><button class="disconnect-button" type="button" data-action="disconnect-data-connection" data-id="' + esc(connection.id) + '">断开</button></article>';
    }).join("");
  }

  function renderDataConnectionModal(focusName = false) {
    if (!modalRoot || !petState.connectionModalOpen) return;
    const draft = petState.connectionDraft || defaultConnectionDraft(), tested = petState.connectionTest?.ok && petState.connectionTest.signature === connectionTestSignature(draft), currentErrors = connectionValidationErrors(draft, true), atLimit = petState.connections.length >= CONNECTION_MAX;
    modalRoot.innerHTML = '<div class="data-connection-backdrop"><section class="data-connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title"><header class="connection-dialog-header"><div><span class="eyebrow">DATA CONNECTION</span><h2 id="connection-dialog-title">数据接入</h2><p>配置数据库或平台接口，并将发现的数据映射为本体图谱气泡。</p></div><button class="dialog-close" type="button" data-action="close-data-connection" aria-label="关闭数据接入弹窗">×</button></header><div class="connection-source-tabs" role="tablist" aria-label="接入类型"><button type="button" role="tab" aria-selected="' + (draft.sourceKind === "database") + '" class="' + (draft.sourceKind === "database" ? "active" : "") + '" data-action="set-connection-source" data-kind="database">' + icon("database", 17) + '数据库</button><button type="button" role="tab" aria-selected="' + (draft.sourceKind === "platform") + '" class="' + (draft.sourceKind === "platform" ? "active" : "") + '" data-action="set-connection-source" data-kind="platform">' + icon("nodes", 17) + '其他平台</button></div><div class="connection-dialog-body"><section class="connection-config-panel"><div class="connection-field-grid">' + renderConnectionForm(draft) + '</div><p class="credential-note">' + icon("shield", 15) + '密码、Token和完整地址仅保留在本次弹窗内存中，关闭后立即清除。</p></section><aside class="connection-preview-panel" aria-live="polite">' + renderConnectionTestPanel(draft) + '</aside></div><section class="connected-sources"><div class="connected-sources-heading"><div><span class="eyebrow">CONNECTED SOURCES</span><h3>已接入数据源</h3></div><span>' + petState.connections.length + ' / ' + CONNECTION_MAX + '</span></div><div class="connected-source-list">' + renderConnectedSources() + '</div></section><footer class="connection-dialog-footer"><span>' + (atLimit ? "已达到外接平台上限，可先断开已有连接。" : "测试通过后才能确认接入。") + '</span><div><button class="button" type="button" data-action="close-data-connection"><span>取消</span></button>' + button(petState.connectionTesting ? "测试中" : "测试连接", "test-data-connection", { iconName: "refresh", disabled: petState.connectionTesting || atLimit }) + button("确认接入", "confirm-data-connection", { primary: true, iconName: "check", disabled: !tested || currentErrors.length > 0 || atLimit }) + '</div></footer></section></div>';
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      const selector = focusName ? '[data-connection-field="name"]' : tested ? '[data-action="confirm-data-connection"]:not([disabled])' : petState.connectionTesting ? '[data-action="close-data-connection"]' : '[data-action="test-data-connection"]:not([disabled])';
      const preferred = modalRoot.querySelector(selector), fallback = modalRoot.querySelector('button:not([disabled]),input:not([disabled]),select:not([disabled])');
      (preferred || fallback)?.focus();
    });
  }

  function openDataConnectionModal(trigger) {
    if (!modalRoot) return toast("弹窗容器尚未加载");
    petState.connectionReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    petState.connectionTestRequestId += 1; app.inert = true;
    petState.connectionDraft = defaultConnectionDraft("database");
    petState.connectionTest = null; petState.connectionTesting = false; petState.connectionModalOpen = true;
    renderDataConnectionModal(true);
  }

  function closeDataConnectionModal(restoreFocus = true) {
    if (!petState.connectionModalOpen) return;
    if (petState.connectionDraft) petState.connectionDraft.secret = "";
    petState.connectionTestRequestId += 1; petState.connectionDraft = null; petState.connectionTest = null; petState.connectionTesting = false; petState.connectionModalOpen = false;
    if (modalRoot) modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open"); app.inert = false;
    const returnTarget = petState.connectionReturnFocus; petState.connectionReturnFocus = null;
    if (restoreFocus && returnTarget?.isConnected) requestAnimationFrame(() => returnTarget.focus());
  }

  function updateConnectionDraftField(input) {
    if (!petState.connectionModalOpen || !petState.connectionDraft || !input.matches("[data-connection-field]")) return;
    petState.connectionDraft[input.dataset.connectionField] = input.value;
    petState.connectionTestRequestId += 1; petState.connectionTesting = false; petState.connectionTest = null;
    const confirmButton = modalRoot?.querySelector('[data-action="confirm-data-connection"]'); if (confirmButton) confirmButton.disabled = true;
    const preview = modalRoot?.querySelector(".connection-preview-panel"); if (preview) preview.innerHTML = renderConnectionTestPanel(petState.connectionDraft);
  }

  async function testDataConnection() {
    if (petState.connectionTesting || !petState.connectionDraft) return;
    const draft = petState.connectionDraft, errors = connectionValidationErrors(draft, true);
    if (errors.length) { petState.connectionTest = { ok: false, message: errors[0], signature: connectionTestSignature(draft) }; renderDataConnectionModal(); return toast(errors[0]); }
    const signature = connectionTestSignature(draft), requestId = ++petState.connectionTestRequestId;
    petState.connectionTesting = true; petState.connectionTest = null; renderDataConnectionModal();
    try {
      const payload = await apiRequest("/api/data-connections/test", { method: "POST", body: JSON.stringify({ ...draft, endpoint: connectionEndpoint(draft), experimentRevision: petState.experimentRevision }) });
      if (!petState.connectionModalOpen || requestId !== petState.connectionTestRequestId || connectionTestSignature(petState.connectionDraft) !== signature) return;
      const data = payload.data || {}, categories = (data.categories || []).map(item => ({ label: item.name, count: item.recordCount }));
      petState.connectionTesting = false;
      petState.connectionTest = { ok: true, signature, testToken: data.testToken, preview: { categories, recordCount: data.recordCount, dataVersion: data.dataVersion, syncedAt: data.syncedAt, matchMethod: data.matchMethod } };
      renderDataConnectionModal();
    } catch (error) {
      if (requestId !== petState.connectionTestRequestId) return;
      petState.connectionTesting = false; petState.connectionTest = { ok: false, message: error.message, signature }; renderDataConnectionModal();
    }
  }

  function invalidateAfterConnectionChange() {
    Object.assign(petState.workflow, { ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: dataConnectionFingerprint() });
    petState.run = null; removeStore(STORE.petRun); persistWorkflow();
  }

  function refreshGraphAfterConnectionChange() {
    petState.graphAnimating = false;
    if (getRoute().path !== "/pet/graph" || !petState.workflow.ontologyBuilt || !document.querySelector(".ontology-panel")) return;
    patchOntologyFocusDom(renderPetGraph());
  }

  function emphasizeNewConnection(connectionId) {
    petState.focusNodeId = "pet-master"; petState.newConnectionId = connectionId;
    refreshGraphAfterConnectionChange();
    setTimeout(() => { document.querySelector('[data-node-id="' + connectionId + '"]')?.classList.remove("connection-highlight"); if (petState.newConnectionId === connectionId) petState.newConnectionId = null; }, 2800);
  }

  async function confirmDataConnection() {
    const draft = petState.connectionDraft; if (!draft) return;
    const errors = connectionValidationErrors(draft, true), signature = connectionTestSignature(draft);
    if (errors.length) return toast(errors[0]);
    if (!petState.connectionTest?.ok || petState.connectionTest.signature !== signature) return toast("请先完成当前配置的连接测试");
    try {
      const payload = await apiRequest("/api/data-connections", { method: "POST", body: JSON.stringify({ testToken: petState.connectionTest.testToken, experimentRevision: petState.experimentRevision }) });
      const data = payload.data || {}, connection = { ...data.connection, categories: (data.connection?.categories || []).map(item => ({ label: item.label || item.name, count: Number(item.count ?? item.recordCount ?? 0) })) };
      petState.experimentRevision = data.experimentRevision; petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
      petState.connections.push(connection); closeDataConnectionModal(); emphasizeNewConnection(connection.id);
      toast(connection.name + "已接入，本体关系待人工核验");
    } catch (error) { toast(error.message); }
  }

  async function disconnectDataConnection(connectionId) {
    const connection = petState.connections.find(item => item.id === connectionId); if (!connection) return;
    try {
      const payload = await apiRequest(`/api/data-connections/${encodeURIComponent(connectionId)}`, { method: "DELETE", body: JSON.stringify({ experimentRevision: petState.experimentRevision }) });
      const data = payload.data || {};
      petState.experimentRevision = data.experimentRevision; petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
      petState.connections = petState.connections.filter(item => item.id !== connectionId);
      if (petState.focusNodeId === connectionId || petState.focusNodeId.startsWith(connectionId + "-")) petState.focusNodeId = "pet-master";
      petState.newConnectionId = null; refreshGraphAfterConnectionChange(); renderDataConnectionModal();
      toast(connection.name + "已断开，关联气泡和下游快照已失效");
    } catch (error) { toast(error.message); }
  }
  const BACKEND_BUSINESS_ACTIONS = new Set(["complete-intake", "complete-image-review", "build-ontology", "confirm-ontology", "rebuild-ontology", "freeze-snapshot", "confirm-validation", "reset-pet-workflow"]);
  async function handleBackendBusinessAction(action) {
    try {
      if (action === "complete-image-review") {
        if (!petState.workflow.imageReviewComplete) return toast("请先保存诊疗图片人工审核结果");
        location.hash = "#/pet/graph"; render(); return toast("诊疗图片人工审核已登记，请构建本体图谱");
      }
      let path = "", body = { experimentRevision: petState.experimentRevision };
      if (action === "complete-intake") path = `/api/claims/${encodeURIComponent(selectedClaim().id)}/materials/confirm`;
      if (["build-ontology", "rebuild-ontology"].includes(action)) path = "/api/ontology/build";
      if (action === "confirm-ontology") path = "/api/ontology/confirm";
      if (action === "freeze-snapshot") path = "/api/fact-snapshots/freeze";
      if (action === "confirm-validation") {
        if (!petState.activeStrategyId) return toast("当前候选策略尚未保存");
        path = `/api/strategies/${encodeURIComponent(petState.activeStrategyId)}/validation-confirmations`;
      }
      if (action === "reset-pet-workflow") path = "/api/demo/reset";
      petState.backendBusy = true;
      const payload = await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
      const data = payload.data || {};
      if (action === "reset-pet-workflow") {
        hydrateBackendState(data); petState.focusNodeId = "pet-master"; petState.ruleParsed = false; location.hash = "#/pet/intake";
      } else {
        petState.experimentRevision = Number(data.experimentRevision || petState.experimentRevision);
        petState.workflow = { ...petState.workflow, ...(data.workflow || {}) };
        if (data.snapshot) petState.backendSnapshot = data.snapshot;
        if (data.validation) petState.backendValidation = data.validation;
        if (action === "complete-intake") { petState.selectedEvidenceId = "image"; location.hash = "#/pet/intake?evidence=image"; }
        if (["build-ontology", "rebuild-ontology"].includes(action)) { petState.focusNodeId = "pet-master"; location.hash = "#/pet/graph"; }
        if (action === "confirm-ontology") location.hash = "#/pet/datasets";
        if (action === "freeze-snapshot") location.hash = "#/pet/strategies";
        if (action === "confirm-validation") location.hash = "#/pet/simulation";
      }
      petState.backendBusy = false; render();
      const messages = { "complete-intake": "文本材料已核对，请完成诊疗图片人工审核", "build-ontology": "跨平台身份匹配完成，本体图谱已构建", "rebuild-ontology": "本体图谱已重新构建", "confirm-ontology": "本体事实与跨平台关系已人工确认", "freeze-snapshot": "FactSnapshot已冻结，候选策略可以绑定该快照", "confirm-validation": "规则检查已确认，可以运行仿真", "reset-pet-workflow": "演示流程已在后端重置" };
      toast(messages[action] || "操作已完成");
    } catch (error) {
      petState.backendBusy = false;
      if (error.code === "STALE_STATE") await loadBackendState(false);
      render(); toast(error.message);
    }
  }
  function handleClick(event) {
    if (event.target.matches(".data-connection-backdrop")) { closeDataConnectionModal(); return; }
    const target = event.target.closest("[data-action]"); if (!target) return; const action = target.dataset.action;
    if (BACKEND_BUSINESS_ACTIONS.has(action)) { event.preventDefault(); handleBackendBusinessAction(action); return; }
    if (action === "open-data-connection") openDataConnectionModal(target);
    if (action === "close-data-connection") closeDataConnectionModal();
    if (action === "set-connection-source") { petState.connectionTestRequestId += 1; petState.connectionDraft = defaultConnectionDraft(target.dataset.kind); petState.connectionTest = null; petState.connectionTesting = false; renderDataConnectionModal(true); }
    if (action === "test-data-connection") testDataConnection();
    if (action === "confirm-data-connection") confirmDataConnection();
    if (action === "disconnect-data-connection") disconnectDataConnection(target.dataset.id);
    if (action === "run-pet-simulation") runPetSimulation();
    if (action === "use-rule-example") { petState.parseRequestId += 1; petState.ruleParsing = false; petState.ruleSource = strategyExamples()[Number(target.dataset.index)] || strategyExamples()[0]; petState.ruleParsed = false; petState.ruleDraftConfirmed = false; petState.modelParseError = ""; petState.modelParseMeta = null; render(); document.querySelector('[data-input="rule-source"]')?.focus(); }
    if (action === "clear-rule-source") { petState.parseRequestId += 1; petState.ruleParsing = false; petState.ruleSource = ""; petState.ruleParsed = false; petState.ruleDraft = cloneRule(petState.candidateRule); petState.ruleDraftConfirmed = true; petState.modelParseError = ""; petState.modelParseMeta = null; render(); document.querySelector('[data-input="rule-source"]')?.focus(); }
    if (action === "parse-model-rule") parseRuleWithModel();
    if (action === "parse-local-rule") parseRuleLocally();
    if (action === "test-model-settings") testModelSettings();
    if (action === "save-model-settings") saveModelSettings(false);
    if (action === "save-model-settings-return") saveModelSettings(true);
    if (action === "clear-model-settings") clearModelSettings();
    if (action === "add-rule-condition") addRuleCondition();
    if (action === "remove-rule-condition") removeRuleCondition(target.dataset.id);
    if (action === "confirm-and-save-rule") confirmAndSaveRuleDraft();
    if (action === "export-pet-report") exportReport();
    if (["open-changed-cases", "kpi-drill"].includes(action)) { petState.filters.transition = "CHANGED"; petState.casePage = 0; location.hash = "#/pet/cases?transition=CHANGED"; }
    if (action === "select-pet-dataset") { petState.dataset = target.dataset.id; writeStore(STORE.petDataset, petState.dataset); Object.assign(petState.workflow, { idMatched: false, ontologyBuilt: false, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null }); petState.run = null; petState.focusNodeId = "pet-master"; petState.graphAnimating = false; removeStore(STORE.petRun); persistWorkflow(); render(); toast("已切换数据集；请重新构建本体图谱并冻结FactSnapshot"); }
    if (action === "select-pet-claim") { petState.selectedClaimId = target.dataset.id; petState.selectedEvidenceId = location.hash.includes("/review") ? "image" : "record"; render(); }
    if (action === "select-evidence") { petState.selectedEvidenceId = target.dataset.id; if (location.hash.includes("/pet/intake")) location.hash = `#/pet/intake?evidence=${encodeURIComponent(target.dataset.id)}`; render(); }
    if (action === "focus-ontology-node") transitionOntologyFocus(target.dataset.id);
    if (action === "focus-parent") { const parent = ontologyFocusView(selectedClaim()).parentNode; if (parent) transitionOntologyFocus(parent.id); }
    if (action === "focus-root") transitionOntologyFocus("pet-master");
    if (action === "set-review-status") { const claim = selectedClaim(), key = `${claim.id}:${petState.selectedEvidenceId}`, current = mergedReview(claim, petState.selectedEvidenceId), status = target.dataset.status, tag = reviewTag(current.tagCode), compatible = tag?.statuses.includes(status); petState.reviewDraft[key] = { ...(petState.reviewDraft[key] || {}), status, tagCode: compatible ? current.tagCode : "", tagLabel: compatible ? tag.label : "" }; render(); }
    if (action === "save-image-review") saveReview();
    if (action === "complete-intake") { Object.assign(petState.workflow, { materialsRegistered: true, ocrValidated: true }); invalidateAfterEvidence(); petState.workflow.materialsRegistered = true; petState.workflow.ocrValidated = true; petState.selectedEvidenceId = "image"; persistWorkflow(); location.hash = "#/pet/intake?evidence=image"; render(); toast("文本材料已核对，请完成诊疗图片人工审核"); }
    if (action === "open-diagnostic-image") { petState.selectedEvidenceId = "image"; location.hash = "#/pet/intake?evidence=image"; render(); }
    if (action === "complete-image-review") { const claim = selectedClaim(), selected = evidenceFor(claim).find(item => item.id === petState.selectedEvidenceId), savedRecord = selected ? petState.reviews[`${claim.id}:${selected.id}`] : null, saved = savedRecord ? currentReview(claim, selected.id) : null; if (!(petState.workflow.materialsRegistered && petState.workflow.ocrValidated)) return toast("请先完成文本材料核对"); if (!selected || selected.type !== "诊疗图片" || !saved || reviewErrors(saved).length) return toast("请先保存完整的诊疗图片人工审核结果"); petState.workflow.imageReviewComplete = true; persistWorkflow(); location.hash = "#/pet/graph"; render(); toast("诊疗图片人工审核结果已登记，请构建本体图谱"); }
    if (action === "build-ontology") { Object.assign(petState.workflow, { idMatched: true, ontologyBuilt: true, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null }); petState.focusNodeId = "pet-master"; petState.graphAnimating = false; petState.run = null; removeStore(STORE.petRun); persistWorkflow(); render(); toast("跨平台身份匹配完成，本体图谱已构建"); }
    if (action === "confirm-ontology") { petState.workflow.ontologyConfirmed = true; petState.workflow.connectionFingerprint = dataConnectionFingerprint(); persistWorkflow(); location.hash = "#/pet/datasets"; render(); toast("本体事实与跨平台关系已人工确认"); }
    if (action === "rebuild-ontology") { Object.assign(petState.workflow, { idMatched: false, ontologyBuilt: false, ontologyConfirmed: false, snapshotFrozen: false, candidateSaved: false, validationPassed: false, snapshotFrozenAt: null, snapshotHash: null, connectionFingerprint: null }); petState.focusNodeId = "pet-master"; petState.graphAnimating = false; petState.run = null; removeStore(STORE.petRun); persistWorkflow(); render(); toast("原本体关系与下游快照已失效，请重新匹配平台数据"); }
    if (action === "freeze-snapshot") { if (!petState.workflow.ontologyConfirmed) return toast("请先人工确认本体事实与跨平台关系"); petState.workflow.snapshotFrozen = true; petState.workflow.snapshotFrozenAt = new Date().toLocaleString("zh-CN", { hour12: false }); petState.workflow.connectionFingerprint = dataConnectionFingerprint(); petState.workflow.snapshotHash = `sha256:${stableHash(`${petState.dataset}:${SNAPSHOT.ocr}:${SNAPSHOT.vision}:${SNAPSHOT.ontology}:atlantic-zhejiang-xiehe-pay-registry:${dataConnectionFingerprint()}:${Object.keys(petState.reviews).length}`)}…${stableHash("pet-gi-frozen").slice(-4)}`; petState.workflow.candidateSaved = false; petState.workflow.validationPassed = false; persistWorkflow(); location.hash = "#/pet/strategies"; render(); toast("FactSnapshot已冻结，候选策略可以绑定该快照"); }

    if (action === "confirm-validation") { if (!petState.workflow.snapshotFrozen || !petState.workflow.candidateSaved) return toast("仍有前置条件未满足"); if (validationChecks(petState.candidateRule).some(check => check.level === "error")) return toast("规则检查存在阻断"); petState.workflow.validationPassed = true; persistWorkflow(); location.hash = "#/pet/simulation"; render(); toast("规则检查已确认，可以运行仿真"); }
    if (action === "reset-pet-workflow") { petState.workflow = { ...DEFAULT_WORKFLOW }; petState.run = null; petState.candidateRule = defaultCandidateRule(500); petState.ruleDraft = cloneRule(petState.candidateRule); petState.ruleSource = petState.candidateRule.sourceText; petState.ruleParsed = false; petState.parseRequestId += 1; petState.ruleParsing = false; petState.ruleDraftConfirmed = true; petState.focusNodeId = "pet-master"; petState.graphAnimating = false; petState.connections = []; petState.newConnectionId = null; removeStore(STORE.petRun); removeStore(STORE.petWorkflow); removeStore(STORE.petConnections); removeStore(STORE.petCandidateRule); writeStore(STORE.petThreshold, 500); location.hash = "#/pet/intake"; render(); toast("演示流程已重置"); }
    if (action === "select-case") { petState.selectedClaimId = target.dataset.id; render(); }
    if (action === "case-prev" && petState.casePage > 0) { petState.casePage -= 1; const first = filteredCases()[petState.casePage * 15]; if (first) petState.selectedClaimId = first.id; render(); }
    if (action === "case-next") { const rows = filteredCases(), maxPage = Math.max(0, Math.ceil(rows.length / 15) - 1); if (petState.casePage < maxPage) { petState.casePage += 1; const first = rows[petState.casePage * 15]; if (first) petState.selectedClaimId = first.id; render(); } }
    if (action === "save-credit-strategy") { creditState.rules = { ...creditState.draft }; writeStore(STORE.creditRules, creditState.rules); creditState.run = calculateCreditSimulation(creditState.rules); render(); toast("信贷候选策略已保存"); }
    if (action === "run-credit-simulation") { creditState.run = calculateCreditSimulation(creditState.rules); render(); toast("信贷仿真已完成"); }
    if (action === "upload-pet-data") toast("MVP使用内置冻结数据；真实数据接入在后续路线中");
  }
  function handleInput(event) {
    const input = event.target;
    if (input.matches("[data-connection-field]")) updateConnectionDraftField(input);
    if (input.matches("[data-model-setting]")) { const key = input.dataset.modelSetting; if (key === "timeoutSeconds") petState.modelSettingsDraft.timeoutMs = Math.max(5000, Math.min(120000, Number(input.value || 30) * 1000)); else petState.modelSettingsDraft[key] = input.value; petState.modelSettingsError = ""; }
    if (input.matches('[data-input="rule-source"]')) {
      petState.ruleSource = input.value; petState.ruleParsed = false; petState.ruleDraftConfirmed = false; petState.modelParseError = ""; petState.modelParseMeta = null;
      const parseButton = document.querySelector('[data-action="parse-model-rule"]'); if (parseButton) parseButton.disabled = !input.value.trim() || petState.ruleParsing;
      const status = document.querySelector(".result-pane .compiler-pane-head > .status"); if (status) { status.className = "status orange"; status.innerHTML = "<i></i>输入已变化"; }
      const confirmButton = document.querySelector('[data-action="confirm-and-save-rule"]'); if (confirmButton) confirmButton.disabled = true;
    }
    if (input.matches("[data-rule-condition-value]")) {
      const condition = petState.ruleDraft.conditions.find(item => item.id === input.dataset.ruleConditionValue), meta = condition && RULE_FIELDS[condition.field];
      if (condition && meta) { condition.value = readRuleEditorValue(input, meta, condition); condition.needsConfirmation = false; markRuleDraftChanged(["VAGUE_VALUE"]); refreshRuleDraftFeedback(); }
    }
    if (input.matches('[data-input="review-comment"]')) { const key = selectedClaim().id + ":" + petState.selectedEvidenceId; petState.reviewDraft[key] = { ...(petState.reviewDraft[key] || {}), comment: input.value }; updateReviewValidationUi(); }
    if (input.matches("[data-credit-field]")) creditState.draft[input.dataset.creditField] = Number(input.value);
    if (input.matches('[data-input="case-search"]')) { petState.filters.search = input.value; petState.casePage = 0; render(); const field = document.querySelector('[data-input="case-search"]'); field?.focus(); field?.setSelectionRange(field.value.length, field.value.length); }
  }
  function handleChange(event) {
    const input = event.target;
    if (input.matches('[data-input="solution-switch"]')) location.hash = input.value === "pet" ? "#/pet/intake" : "#/credit/datasets";
    if (input.matches("[data-rule-scope]")) { petState.ruleDraft.scope[input.dataset.ruleScope] = input.value; markRuleDraftChanged(); render(); }
    if (input.matches("[data-rule-logic]")) { petState.ruleDraft.logic = input.value; markRuleDraftChanged(["MIXED_LOGIC","NESTED_LOGIC"]); render(); }
    if (input.matches("[data-rule-condition-field]")) {
      const condition = petState.ruleDraft.conditions.find(item => item.id === input.dataset.ruleConditionField), meta = RULE_FIELDS[input.value];
      if (condition && meta) { Object.assign(condition, { field: input.value, operator: meta.operators[0], value: meta.valueType === "number" ? "" : meta.valueType === "boolean" ? true : "PASS", valueType: meta.valueType, unit: meta.unit, needsConfirmation: false }); markRuleDraftChanged(["VAGUE_VALUE"]); render(); }
    }
    if (input.matches("[data-rule-condition-operator]")) { const condition = petState.ruleDraft.conditions.find(item => item.id === input.dataset.ruleConditionOperator); if (condition) { const collection = ["IN", "NOT_IN"].includes(input.value); condition.operator = input.value; condition.value = collection ? (Array.isArray(condition.value) ? condition.value : [condition.value].filter(value => value !== "" && value != null)) : (Array.isArray(condition.value) ? (condition.value[0] ?? "") : condition.value); condition.needsConfirmation = false; markRuleDraftChanged(); render(); } }
    if (input.matches("[data-rule-condition-value]")) { const condition = petState.ruleDraft.conditions.find(item => item.id === input.dataset.ruleConditionValue), meta = condition && RULE_FIELDS[condition.field]; if (condition && meta) { condition.value = readRuleEditorValue(input, meta, condition); condition.needsConfirmation = false; markRuleDraftChanged(["VAGUE_VALUE"]); render(); } }
    if (input.matches("[data-rule-action]")) { const branch = input.dataset.ruleBranch, dimension = input.dataset.ruleAction; petState.ruleDraft[branch][dimension] = input.value; markRuleDraftChanged(["FORBIDDEN_REJECT"]); render(); }
    if (input.matches("[data-rule-missing]")) { petState.ruleDraft.onMissing = input.value; markRuleDraftChanged(); render(); }
    if (input.matches('[data-input="review-tag"]')) { const key = selectedClaim().id + ":" + petState.selectedEvidenceId, tag = reviewTag(input.value); petState.reviewDraft[key] = { ...(petState.reviewDraft[key] || {}), tagCode: tag?.code || "", tagLabel: tag?.label || "" }; render(); }
    if (input.matches('[data-input="case-transition"]')) { petState.filters.transition = input.value; petState.casePage = 0; render(); }
    if (input.matches('[data-input="case-recommendation"]')) { petState.filters.recommendation = input.value; petState.casePage = 0; render(); }
    if (input.matches('[data-input="case-region"]')) { petState.filters.region = input.value; petState.casePage = 0; render(); }
    if (input.matches('[data-input="evidence-upload"]')) handleUpload(input.files?.[0]);
  }
  function handleSubmit(event) { if (!event.target.matches('[data-form="global-search"]')) return; event.preventDefault(); const query = new FormData(event.target).get("q")?.trim(); if (!query) return; const normalized = query.toLowerCase(); if (normalized.includes("baseline") || normalized.includes("candidate") || normalized.includes("策略")) { location.hash = "#/pet/strategies"; return; } const claim = petClaims.find(item => `${item.id} ${item.policyId} ${item.petName}`.toLowerCase().includes(normalized)); if (claim) { petState.selectedClaimId = claim.id; petState.filters = { ...petState.filters, transition: "ALL", search: "" }; location.hash = `#/pet/cases?claim=${claim.id}&transition=ALL`; } else toast("未找到匹配的案件、保单或策略"); }
  function handleKeydown(event) {
    if (petState.connectionModalOpen) {
      if (event.key === "Escape") { event.preventDefault(); closeDataConnectionModal(); return; }
      if (event.key === "Tab") {
        const focusable = [...modalRoot.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if (focusable.length) { const first = focusable[0], last = focusable[focusable.length - 1], focusInside = modalRoot.contains(document.activeElement); if (!focusInside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector(".global-search input")?.focus(); }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".ontology-bubble[data-action]")) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  }

  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", handleKeydown);
  render();
  Promise.all([loadBackendState(false), loadModelSettings(false)]).finally(() => render());
})();
