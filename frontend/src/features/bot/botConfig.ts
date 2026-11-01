import type { BotConfig } from "../../api/client";

export const TICKER_PATTERN = /^[A-Za-z0-9._-]+$/;

export const REGIME_LABELS: Record<string, string> = {
  TREND: "Tendance",
  RANGE: "Marché sans direction",
  HIGH_VOLATILITY: "Forte volatilité",
};

type NumericKey = {
  [K in keyof BotConfig]: BotConfig[K] extends number ? K : never;
}[keyof BotConfig];

export type NumericFieldMeta = {
  key: NumericKey;
  label: string;
  hint: string;
  unit?: string;
  /** Bounds as enforced by the backend (schemas.BotConfig), in stored units. */
  min: number;
  max: number;
  step: number;
  /** Displayed value = stored / scale (e.g. seconds shown as minutes). */
  scale?: number;
};

export const BUDGET_FIELDS: NumericFieldMeta[] = [
  {
    key: "allocated_cash_amount",
    label: "Budget confié au bot",
    hint: "Le bot n'utilise jamais plus que ce montant, quel que soit ton solde.",
    unit: "€",
    min: 20,
    max: 1_000_000,
    step: 10,
  },
  {
    key: "min_trade_notional",
    label: "Montant minimum par ordre",
    hint: "En dessous, le bot ne passe pas l'ordre (évite les micro-ordres).",
    unit: "€",
    min: 5,
    max: 100_000,
    step: 5,
  },
  {
    key: "max_order_quantity",
    label: "Quantité maximum par ordre",
    hint: "Plafond en nombre de titres pour un seul ordre.",
    unit: "titres",
    min: 0.0001,
    max: 10_000,
    step: 0.1,
  },
];

export type AdvancedGroup = {
  title: string;
  intro: string;
  numbers: NumericFieldMeta[];
  toggles: { key: "reanchor_on_breakout" | "regime_filter_enabled" | "signal_filter_enabled" | "extended_hours"; label: string; hint: string }[];
};

export const ADVANCED_GROUPS: AdvancedGroup[] = [
  {
    title: "Signal d'entrée et de sortie",
    intro: "Comment le bot décide d'acheter ou de vendre : moyennes mobiles, RSI et filtre de confiance.",
    numbers: [
      { key: "short_window", label: "Moyenne mobile courte", hint: "Nombre de bougies de la moyenne rapide.", unit: "bougies", min: 2, max: 120, step: 1 },
      { key: "long_window", label: "Moyenne mobile longue", hint: "Doit être plus longue que la courte.", unit: "bougies", min: 3, max: 240, step: 1 },
      { key: "rsi_period", label: "Période du RSI", hint: "14 est la valeur classique.", unit: "bougies", min: 5, max: 100, step: 1 },
      { key: "buy_rsi_max", label: "RSI maximum pour acheter", hint: "Au-dessus, le titre est jugé trop cher (suracheté).", min: 1, max: 99, step: 1 },
      { key: "sell_rsi_min", label: "RSI minimum pour vendre", hint: "Doit rester inférieur au RSI d'achat.", min: 1, max: 99, step: 1 },
      { key: "trend_tolerance_pct", label: "Tolérance de tendance", hint: "Écart toléré autour de la moyenne longue.", unit: "%", min: 0, max: 10, step: 0.1 },
      { key: "signal_probability_threshold", label: "Confiance minimum du signal", hint: "0,6 = 60 %. Plus haut : moins de trades, plus sûrs.", min: 0.5, max: 0.99, step: 0.01 },
    ],
    toggles: [
      { key: "regime_filter_enabled", label: "Filtre de régime de marché", hint: "N'achète pas quand le marché est jugé trop volatil." },
      { key: "signal_filter_enabled", label: "Filtre de confiance", hint: "Ignore les signaux sous le seuil de confiance." },
    ],
  },
  {
    title: "Gestion du risque",
    intro: "Taille des positions et sorties automatiques, calculées sur la volatilité (ATR).",
    numbers: [
      { key: "risk_per_trade_pct", label: "Risque par trade", hint: "Part du budget qu'un trade peut perdre au stop.", unit: "%", min: 0.1, max: 5, step: 0.1 },
      { key: "stop_loss_atr_multiplier", label: "Stop loss", hint: "Distance du stop en multiples de l'ATR.", unit: "× ATR", min: 0.5, max: 8, step: 0.1 },
      { key: "take_profit_atr_multiplier", label: "Prise de bénéfice", hint: "Objectif de gain en multiples de l'ATR.", unit: "× ATR", min: 0.5, max: 15, step: 0.1 },
      { key: "atr_period", label: "Période de l'ATR", hint: "Fenêtre de calcul de la volatilité.", unit: "bougies", min: 5, max: 120, step: 1 },
    ],
    toggles: [],
  },
  {
    title: "Garde-fous et rythme",
    intro: "Limites qui arrêtent le bot après des pertes ou trop d'activité.",
    numbers: [
      { key: "max_daily_drawdown_pct", label: "Perte maximale sur la journée", hint: "Au-delà, plus aucun achat jusqu'au lendemain.", unit: "%", min: 0.5, max: 30, step: 0.5 },
      { key: "max_weekly_drawdown_pct", label: "Perte maximale sur la semaine", hint: "Doit être au moins égale à la limite journalière.", unit: "%", min: 1, max: 50, step: 0.5 },
      { key: "stop_guard_drawdown_pct", label: "Seuil d'alerte (pause)", hint: "Perte qui déclenche une pause de prudence.", unit: "%", min: 0.2, max: 30, step: 0.1 },
      { key: "max_daily_trades", label: "Trades maximum par jour", hint: "Plafond d'ordres passés en une journée.", min: 1, max: 100, step: 1 },
      { key: "cooldown_after_win_seconds", label: "Pause après un gain", hint: "Délai avant de retrader le même titre.", unit: "min", min: 0, max: 86_400, step: 60, scale: 60 },
      { key: "cooldown_after_loss_seconds", label: "Pause après une perte", hint: "Délai avant de retrader le même titre.", unit: "min", min: 0, max: 172_800, step: 60, scale: 60 },
      { key: "poll_interval_seconds", label: "Fréquence d'analyse", hint: "Intervalle entre deux cycles.", unit: "s", min: 10, max: 1800, step: 5 },
    ],
    toggles: [],
  },
  {
    title: "Exécution et grille",
    intro: "Type d'ordre envoyé par le bot et achats échelonnés.",
    numbers: [
      { key: "limit_price_offset_pct", label: "Écart du prix limite", hint: "Marge ajoutée au cours pour les ordres limite.", unit: "%", min: 0.01, max: 5, step: 0.01 },
      { key: "stop_price_offset_pct", label: "Écart du prix stop", hint: "Marge pour les ordres stop.", unit: "%", min: 0.01, max: 5, step: 0.01 },
      { key: "grid_step_pct", label: "Pas de la grille", hint: "Écart entre deux achats échelonnés.", unit: "%", min: 0.2, max: 20, step: 0.1 },
      { key: "max_grid_depth", label: "Profondeur de la grille", hint: "Nombre maximum d'achats échelonnés par titre.", unit: "niveaux", min: 1, max: 30, step: 1 },
    ],
    toggles: [
      { key: "reanchor_on_breakout", label: "Recaler la grille sur les cassures", hint: "Repositionne la grille quand le cours sort par le haut." },
      { key: "extended_hours", label: "Heures étendues", hint: "Autorise les ordres hors séance (liquidité plus faible)." },
    ],
  },
];

export type PresetId = "prudent" | "equilibre" | "dynamique";

export const PRESETS: { id: PresetId; label: string; description: string; values: Partial<BotConfig> }[] = [
  {
    id: "prudent",
    label: "Prudent",
    description: "Peu de trades, risque faible, arrêt rapide en cas de pertes.",
    values: {
      risk_per_trade_pct: 0.5,
      stop_loss_atr_multiplier: 1.5,
      take_profit_atr_multiplier: 2,
      signal_probability_threshold: 0.7,
      max_daily_trades: 4,
      max_daily_drawdown_pct: 3,
      max_weekly_drawdown_pct: 6,
      stop_guard_drawdown_pct: 2.5,
      cooldown_after_loss_seconds: 14_400,
    },
  },
  {
    id: "equilibre",
    label: "Équilibré",
    description: "Réglages par défaut : compromis entre activité et prudence.",
    values: {
      risk_per_trade_pct: 1,
      stop_loss_atr_multiplier: 1.5,
      take_profit_atr_multiplier: 2.5,
      signal_probability_threshold: 0.6,
      max_daily_trades: 8,
      max_daily_drawdown_pct: 5,
      max_weekly_drawdown_pct: 10,
      stop_guard_drawdown_pct: 3.5,
      cooldown_after_loss_seconds: 7_200,
    },
  },
  {
    id: "dynamique",
    label: "Dynamique",
    description: "Plus de trades et de risque, pour un budget que tu acceptes de voir varier.",
    values: {
      risk_per_trade_pct: 2,
      stop_loss_atr_multiplier: 2,
      take_profit_atr_multiplier: 4,
      signal_probability_threshold: 0.55,
      max_daily_trades: 15,
      max_daily_drawdown_pct: 8,
      max_weekly_drawdown_pct: 15,
      stop_guard_drawdown_pct: 5,
      cooldown_after_loss_seconds: 3_600,
    },
  },
];

export function matchingPreset(config: BotConfig): PresetId | null {
  const found = PRESETS.find((preset) =>
    Object.entries(preset.values).every(([key, value]) => config[key as keyof BotConfig] === value)
  );
  return found?.id ?? null;
}

export type ConfigErrors = Partial<Record<keyof BotConfig, string>>;

/** Mirrors the backend validation (schemas.BotConfig) so errors show before saving. */
export function validateBotConfig(config: BotConfig): ConfigErrors {
  const errors: ConfigErrors = {};
  for (const meta of [...BUDGET_FIELDS, ...ADVANCED_GROUPS.flatMap((group) => group.numbers)]) {
    const value = config[meta.key];
    if (!Number.isFinite(value) || value < meta.min || value > meta.max) {
      const scale = meta.scale ?? 1;
      errors[meta.key] = `Entre ${meta.min / scale} et ${meta.max / scale}${meta.unit ? ` ${meta.unit}` : ""}.`;
    }
  }
  if (config.enabled && config.tickers.length === 0) {
    errors.tickers = "Ajoute au moins un titre à surveiller.";
  }
  if (config.tickers.some((ticker) => !TICKER_PATTERN.test(ticker))) {
    errors.tickers = "Ticker invalide : lettres, chiffres, point, tiret ou souligné uniquement.";
  }
  if (config.long_window <= config.short_window) {
    errors.long_window = "Doit être plus longue que la moyenne courte.";
  }
  if (config.sell_rsi_min >= config.buy_rsi_max) {
    errors.sell_rsi_min = "Doit être inférieur au RSI maximum d'achat.";
  }
  if (config.max_weekly_drawdown_pct < config.max_daily_drawdown_pct) {
    errors.max_weekly_drawdown_pct = "Doit être au moins égale à la perte journalière.";
  }
  if (config.min_trade_notional > config.allocated_cash_amount) {
    errors.min_trade_notional = "Ne peut pas dépasser le budget du bot.";
  }
  return errors;
}

export function sameConfig(a: BotConfig, b: BotConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
