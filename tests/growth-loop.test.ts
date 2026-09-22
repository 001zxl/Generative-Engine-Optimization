import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "geo-growth-loop-")), "isolated.db");
process.env.APP_BASE_URL = "http://127.0.0.1:3100";
const R = await import("../src/lib/db/repo-domains.ts");
const sampling = await import("../src/lib/sampling.ts");
const experiments = await import("../src/lib/experiments.ts");
const publishing = await import("../src/lib/publishing.ts");
const { getDb } = await import("../src/lib/db/index.ts");

test("同问题集跨批次复测，真实来源与完整覆盖才生成比较", () => {
  const brand = R.createBrand({ name: "Review Brand", domain: "review.example" });
  const qs = R.createQuerySet("固定买家问题", brand);
  R.addQuestions(qs, ["Which supplier has a small MOQ?", "Which supplier supports CNC?"]);
  assert.equal(R.freezeQuerySet(qs).ok, true);
  const first = R.createSamplingRun({ label: "基线", querySetId: qs, samplingMode: "manual_ui", engines: ["ChatGPT"], repetition: 1 });
  const second = R.createSamplingRun({ label: "另一批次", querySetId: qs, samplingMode: "manual_ui", engines: ["ChatGPT"], repetition: 1 });
  assert.equal(first.tasks, 2);
  assert.equal(second.tasks, 2, "相同问题在新批次不得被全局幂等键吞掉");
  const tasks = R.listSamplingTasks(first.runId);
  const firstSample = sampling.saveManualObservation({ taskId: tasks[0].id, answer: "Review Brand offers small orders.", modelVersion: "consumer-model-1", collectedAt: "2026-09-20T12:00:00Z" });
  sampling.saveManualObservation({ taskId: tasks[1].id, answer: "No supplier mentioned.", modelVersion: "consumer-model-1", collectedAt: "2026-09-20T12:00:00Z" });
  assert.equal(sampling.saveManualObservation({ taskId: tasks[0].id, answer: "Different answer", modelVersion: "consumer-model-1", collectedAt: "2026-09-20T12:00:00Z" }), firstSample, "重试不得覆盖已经采到的原文");
  getDb().prepare("UPDATE sample_provenance SET evidence_kind='fixture' WHERE sample_id=?").run(firstSample);
  assert.throws(() => experiments.createExperiment({ name: "测试", baselineRunId: first.runId, brandId: brand }), /测试夹具/);
  getDb().prepare("UPDATE sample_provenance SET evidence_kind='manual_ui' WHERE sample_id=?").run(firstSample);
  const exp = experiments.createExperiment({ name: "真实推广基线", baselineRunId: first.runId, brandId: brand, intervention: "发布 FAQ" });
  const followup = experiments.createExperimentRetest(exp);
  assert.equal(R.listSamplingTasks(followup).length, 2);
  const empty = experiments.compareExperiment(exp, followup).comparison!;
  assert.equal(empty.status, "incomplete");
  assert.ok(empty.groups.every((g) => g.metrics.every((m) => m.deltaPercentagePoints === null)));
  for (const task of R.listSamplingTasks(followup)) {
    sampling.saveManualObservation({ taskId: task.id, answer: "Review Brand is one option.", modelVersion: "consumer-model-1", collectedAt: "2026-09-22T12:00:00Z" });
  }
  const comparison = experiments.compareExperiment(exp, followup).comparison!;
  assert.equal(comparison.status, "comparable");
  assert.equal(comparison.beforeValid, 2);
  assert.equal(comparison.afterValid, 2);
  const mention = comparison.groups[0].metrics.find((m) => m.metric === "mention_rate")!;
  assert.equal(mention.before?.numerator, 1);
  assert.equal(mention.after?.numerator, 2);
  assert.equal(mention.deltaPercentagePoints, 50);
  assert.match(comparison.interpretation, /观测变化/);
});

test("官方 Sonar 响应保留原文、引用与响应 ID，不混入手工批次", async () => {
  const qs = R.listQuerySets().find((q) => q.name === "固定买家问题")!;
  const run = R.createSamplingRun({ label: "官方接口", querySetId: qs.id, samplingMode: "official_api", engines: ["Perplexity"] });
  process.env.PERPLEXITY_API_KEY = "test-only-key";
  let urlSeen = "";
  const sampleId = await sampling.collectPerplexity(R.listSamplingTasks(run.runId)[0].id, (async (url, options) => {
    urlSeen = String(url);
    assert.match(String((options?.headers as Record<string, string>).authorization), /^Bearer /);
    return new Response(JSON.stringify({ id: "resp_fixture_1", model: "sonar", choices: [{ message: { content: "No brand in this answer." } }], citations: ["https://source.example/page"] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  assert.equal(urlSeen, "https://api.perplexity.ai/v1/sonar");
  assert.equal(R.getSample(sampleId)?.raw_answer, "No brand in this answer.");
  assert.equal(sampling.getSampleProvenance(sampleId)?.provider_response_id, "resp_fixture_1");
  assert.match(sampling.answerForExtraction(R.getSample(sampleId)!), /source\.example/);
  delete process.env.PERPLEXITY_API_KEY;
});

test("审核后的本站发布写回 URL 并可读；同内容重复排队保持幂等", async () => {
  const asset = R.createAsset({ title: "Review Brand MOQ 说明", bodyMd: "标准件起订量见公开事实来源。", author: "编辑团队" });
  R.reviewAsset(asset, "approved");
  const id = publishing.createPublicationDispatch(asset, "own_site");
  assert.equal(publishing.createPublicationDispatch(asset, "own_site"), id);
  const job = await publishing.executePublicationDispatch(id);
  assert.equal(job.status, "succeeded");
  assert.match(job.published_url ?? "", /\/knowledge\//);
  assert.equal(publishing.getPublishedKnowledge(job.slug)?.title, "Review Brand MOQ 说明");
  assert.equal((await publishing.executePublicationDispatch(id)).publication_id, job.publication_id);
});
