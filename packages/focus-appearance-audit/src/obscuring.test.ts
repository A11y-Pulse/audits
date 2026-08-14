import { describe, expect, it } from "vitest";
import { classifyObscuring, type ObscuredMeasurement } from "./obscuring";

function measurement(
	partial: Partial<ObscuredMeasurement>,
): ObscuredMeasurement {
	return {
		coveredFraction: 0,
		fullyObscured: false,
		offscreen: false,
		opacity: "opaque",
		obscuredBy: null,
		...partial,
	};
}

describe("classifyObscuring", () => {
	it("routes opaque full cover to violation", () => {
		expect(
			classifyObscuring(
				measurement({
					fullyObscured: true,
					coveredFraction: 1,
					opacity: "opaque",
					obscuredBy: { selector: "footer", html: "<footer>" },
				}),
			),
		).toBe("violation");
	});

	it("routes unknown-opacity full cover to incomplete", () => {
		expect(
			classifyObscuring(
				measurement({
					fullyObscured: true,
					coveredFraction: 1,
					opacity: "unknown",
				}),
			),
		).toBe("incomplete");
	});

	it("routes offscreen focus to incomplete", () => {
		expect(classifyObscuring(measurement({ offscreen: true }))).toBe(
			"incomplete",
		);
	});

	it("treats semi-transparent full cover as pass for AA", () => {
		expect(
			classifyObscuring(
				measurement({
					fullyObscured: true,
					coveredFraction: 1,
					opacity: "semi-transparent",
				}),
			),
		).toBe("pass");
	});

	it("treats partial cover as pass for AA", () => {
		expect(
			classifyObscuring(
				measurement({
					fullyObscured: false,
					coveredFraction: 0.5,
					opacity: "opaque",
				}),
			),
		).toBe("pass");
	});
});
