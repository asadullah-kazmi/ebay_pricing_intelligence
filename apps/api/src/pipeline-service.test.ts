import { describe, expect, it } from "vitest";
import { pipelineProgress } from "./pipeline-service.js";

describe("pipelineProgress", () => {
  it("reports an empty pipeline as zero percent", () => {
    expect(pipelineProgress(0, 0, 0)).toEqual({ finishedRows: 0, percent: 0 });
  });

  it("counts completed and failed rows as finished", () => {
    expect(pipelineProgress(10, 4, 2)).toEqual({ finishedRows: 6, percent: 60 });
  });

  it("never reports more rows than the job contains", () => {
    expect(pipelineProgress(3, 3, 2)).toEqual({ finishedRows: 3, percent: 100 });
  });
});
