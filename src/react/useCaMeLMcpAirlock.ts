import { useState, useCallback } from "react";
import { ProvenanceEnvelope } from "../index";

export type AirlockState =
  | { status: "IDLE" }
  | { status: "HALT_AMBIGUOUS_SYMBOL"; detectedAmbiguity: string; requiredEnums: string[]; sliderBounds?: { min: number; max: number } }
  | { status: "CAMEL_VIOLATION"; message: string }
  | { status: "SUCCESS"; result: any };

export function useCaMeLMcpAirlock(params: {
  callMcpTool: (toolName: string, args: Record<string, any>) => Promise<any>;
  mintGatewayEnvelopes: (resolution: { actionSymbol: string; sliderValue?: number }) => Promise<Record<string, ProvenanceEnvelope>>;
}) {
  const [status, setStatus] = useState<AirlockState>({ status: "IDLE" });
  const [draftResolution, setDraftResolution] = useState<{ actionSymbol?: string; sliderValue?: number }>({});

  const executeToolWithAirlock = useCallback(async (toolName: string, initialArgs: Record<string, any>) => {
    try {
      setStatus({ status: "IDLE" });
      const res = await params.callMcpTool(toolName, initialArgs);
      if (res?.error && res.error.includes("HALT_AMBIGUOUS_SYMBOL")) {
        setStatus({
          status: "HALT_AMBIGUOUS_SYMBOL",
          detectedAmbiguity: res.detectedAmbiguity,
          requiredEnums: res.requiredEnums,
          sliderBounds: res.sliderBounds,
        });
        return;
      }
      setStatus({ status: "SUCCESS", result: res });
    } catch (err: any) {
      setStatus({ status: "CAMEL_VIOLATION", message: err.message || "Unknown error" });
    }
  }, [params]);

  const commitResolution = useCallback(async (toolName: string) => {
    if (!draftResolution.actionSymbol) return;
    const resolution: { actionSymbol: string; sliderValue?: number } = {
      actionSymbol: draftResolution.actionSymbol,
    };
    if (draftResolution.sliderValue !== undefined) {
      resolution.sliderValue = draftResolution.sliderValue;
    }
    const signedEnvelopes = await params.mintGatewayEnvelopes(resolution);
    await executeToolWithAirlock(toolName, signedEnvelopes);
  }, [draftResolution, params, executeToolWithAirlock]);

  return {
    status,
    draftResolution,
    setDraftResolution,
    executeToolWithAirlock,
    commitResolution,
  };
}
