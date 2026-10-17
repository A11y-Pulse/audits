import type { AdaptorFactories } from "@a11y-pulse/integration-harness";
import { playwrightAdaptors, puppeteerAdaptors } from "../../../src/browsers";
import type { AuditAdaptors } from "../../../src/run-audits";

export const adaptors: AdaptorFactories<AuditAdaptors> = {
	puppeteer: (page) => puppeteerAdaptors(page),
	playwright: (page) => playwrightAdaptors(page),
};
