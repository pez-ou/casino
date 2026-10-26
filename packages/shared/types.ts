export type Phase =
  | "WAITING_FOR_PLAYERS"
  | "BETTING"
  | "DEALING"
  | "INSURANCE"
  | "PLAYER_TURN"
  | "DEALER_TURN"
  | "SETTLEMENT"
  | "ROUND_END"
  | "RESHUFFLE"
  | "BETS_CLOSED"
  | "SPINNING"
  | "RESULT";
export type Card = { id: string; rank: string; suit: string };
export type Hand = {
  id?: string;
  plannedAction?: { type: BlackjackDecision; faceDown?: boolean };
  plannedError?: string;
  seatId?: number;
  cards: Card[];
  bet: number;
  status: "PLAYING" | "STAND" | "BUST" | "BLACKJACK";
  split: boolean;
  faceDown?: boolean;
  result?: string;
  profit?: number;
};
export type Player = {
  exclusionPending?: boolean;
  id: string;
  name: string;
  balance: number;
  insuranceEscrow?: number;
  sideBetEscrow?: number;
  connected: boolean;
  ready: boolean;
  hands: Hand[];
  bet: number;
  stats: {
    hands: number;
    wins: number;
    blackjacks: number;
    profit: number;
    biggestWin: number;
  };
};
export type Rules = {
  dealCardMs?: number;
  dealLeadMs?: number;
  minBet: number;
  maxBet: number;
  maxSideBet?: number;
  maxPlayers: number;
  maxSplits: number;
  doubleAfterSplit: boolean;
  hitSoft17: boolean;
  blackjackPayout: number;
  turnSeconds: number;
  bettingSeconds: number;
  cutRatio: number;
};
export type GameState = {
  dealing?: DealSequence;
  phase: Phase;
  round: number;
  dealer: Card[];
  turn?: { playerId: string; hand: number; seatId?: number };
  seats?: Seat[];
  roulette?: RouletteState;
  deadline: number | null;
  shoe: { remaining: number; total: number; shuffleSoon: boolean };
  history: string[];
  rules: Rules;
};
export type RoomState = {
  serverTime: number;
  code: string;
  gameType: string;
  hostId: string;
  version: number;
  players: Player[];
  game: GameState;
};
export type Action = {
  requestId: string;
  version?: number;
  round?: number;
  type:
    | "REFILL"
    | "CREATE"
    | "JOIN"
    | "READY"
    | "START"
    | "BET"
    | "HIT"
    | "STAND"
    | "DOUBLE"
    | "SPLIT"
    | "LEAVE"
    | "TAKE_INSURANCE"
    | "DECLINE_INSURANCE"
    | "TAKE_SEAT"
    | "LEAVE_SEAT"
    | "BET_ON_SEAT"
    | "ROULETTE_BET"
    | "ACCELERATE_ROUND"
    | "MOVE_BET"
    | "UNDO_BET"
    | "CLEAR_BETS"
    | "REPEAT_BETS"
    | "CANCEL_READY"
    | "PLAN_ACTION"
    | "CANCEL_PLAN"
    | "KICK_PLAYER";
  decision?: BlackjackDecision;
  handId?: string;
  targetPlayerId?: string;
  gameType?: "blackjack" | "roulette";
  seatId?: number;
  hand?: number;
  betId?: string;
  betType?: RouletteBetType;
  numbers?: number[];
  name?: string;
  code?: string;
  amount?: number;
  faceDown?: boolean;
  sideBets?: Partial<Record<"PP" | "21+3", number>>;
};

export type Seat = {
  id: number;
  playerId?: string;
  bet: number;
  hands: Hand[];
  sideBets?: {
    type: "PP" | "21+3";
    amount: number;
    label?: string;
    payout?: number;
    returned?: number;
    profit?: number;
  }[];
  insurance?: {
    decision: "PENDING" | "TAKEN" | "DECLINED";
    amount: number;
    returned?: number;
    profit?: number;
    result?: "WIN" | "LOSE";
  };
};
export type RouletteBetType =
  | "STRAIGHT"
  | "SPLIT"
  | "STREET"
  | "CORNER"
  | "SIX_LINE"
  | "FIRST_FOUR"
  | "RED"
  | "BLACK"
  | "EVEN"
  | "ODD"
  | "LOW"
  | "HIGH"
  | "DOZEN"
  | "COLUMN";
export type RouletteBet = {
  id: string;
  playerId: string;
  type: RouletteBetType;
  numbers: number[];
  amount: number;
  payout: number;
  returned?: number;
};
export type RouletteState = {
  bets: RouletteBet[];
  winningNumber?: number;
  spinStartedAt?: number;
  spinEndsAt?: number;
  bettingEndsAt: number;
  bettingStartedAt: number;
  accelerationVotes: string[];
  history: number[];
  roundsPlayed: number;
  results: Record<string, { wager: number; returned: number; profit: number }>;
  durations: { betting: number; spin: number; result: number };
};

export type BlackjackDecision = "HIT" | "STAND" | "DOUBLE" | "SPLIT";
export type DealEvent = {
  round: number;
  seq: number;
  seatId: number | null;
  at: number;
  card: Card;
};
export type DealSequence = {
  round: number;
  startedAt: number;
  endsAt: number;
  cardMs: number;
  total: number;
  events: DealEvent[];
};
