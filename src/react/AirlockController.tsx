import React from "react";

export interface AirlockControllerProps {
  ambiguityState: {
    detectedAmbiguity: string;
    requiredEnums: string[];
    sliderBounds?: { min: number; max: number };
  };
  selectedEnum?: string;
  onSelectEnum: (val: string) => void;
  sliderValue?: number;
  onChangeSlider: (val: number) => void;
  onCommit: () => void;
}

export const AirlockController: React.FC<AirlockControllerProps> = ({
  ambiguityState,
  selectedEnum,
  onSelectEnum,
  sliderValue,
  onChangeSlider,
  onCommit,
}) => {
  return (
    <div className="p-6 bg-slate-900 border border-amber-500/30 rounded-xl text-slate-100 max-w-xl shadow-2xl font-mono">
      <div className="flex items-center gap-3 mb-4">
        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded">
          HALT_AMBIGUOUS_SYMBOL
        </span>
        <h2 className="text-sm font-semibold tracking-wide text-slate-200">
          CaMeL Zero-Trust Airlock Intercept
        </h2>
      </div>

      <p className="text-xs text-slate-400 mb-6 leading-relaxed">
        Overloaded verb detected: <span className="text-amber-300 font-bold">&quot;{ambiguityState.detectedAmbiguity}&quot;</span>. 
        Select a deterministic action symbol to resolve intent without second-pass LLM guessing.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
            Select Bounded Action Enum
          </label>
          <div className="grid grid-cols-1 gap-2">
            {ambiguityState.requiredEnums.map((opt) => (
              <button
                key={opt}
                onClick={() => onSelectEnum(opt)}
                className={`px-4 py-2.5 text-xs text-left rounded-lg border transition-all ${
                  selectedEnum === opt
                    ? "bg-amber-500/10 border-amber-500 text-amber-300 font-bold shadow-inner"
                    : "bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-600"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {ambiguityState.sliderBounds && (
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Clamped Numeric Boundary</span>
              <span className="text-amber-400 font-bold">{sliderValue ?? ambiguityState.sliderBounds.min}</span>
            </div>
            <input
              type="range"
              min={ambiguityState.sliderBounds.min}
              max={ambiguityState.sliderBounds.max}
              value={sliderValue ?? ambiguityState.sliderBounds.min}
              onChange={(e) => onChangeSlider(Number(e.target.value))}
              className="w-full accent-amber-500 bg-slate-800 cursor-pointer"
            />
          </div>
        )}
      </div>

      <button
        onClick={onCommit}
        disabled={!selectedEnum}
        className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-all shadow-lg"
      >
        Sign & Execute Bounded Control Envelope
      </button>
    </div>
  );
};
