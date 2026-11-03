export type RewardState = {
  status: "not_connected";
  title: string;
  detail: string;
};

export type PublicMeasure = {
  id: string;
  construct: string;
  questionText: string;
  type: string;
  stage: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleLabels?: string[];
  options?: string[];
  required: boolean;
};

export type PublicFlowStep =
  | { id: string; type: "consent"; title: string }
  | { id: string; type: "survey"; title: string; stage: string; measureIds: string[] }
  | { id: string; type: "stimulus"; title: string }
  | { id: string; type: "behavior_task"; title: string; objectId: string }
  | { id: string; type: "debrief"; title: string; body: string }
  | { id: string; type: "complete"; title: string };

export type PublicStimulus = {
  id: string;
  title: string;
  body: string;
  tone: string;
  reasonShown: boolean;
  reasonText?: string;
  ctaLabel: string;
  criteriaButtonLabel: string;
  criteriaDetail: string;
};

export type ParticipantView = {
  participantId: string;
  sessionId: string;
  studyId: string;
  studyTitle: string;
  studyVersionId: string;
  stimulus: PublicStimulus;
  flow: PublicFlowStep[];
  measures: PublicMeasure[];
  consentText: string;
  debriefText: string;
  currentStepId: string;
  status: "active" | "completed" | "dropout" | "abandoned";
  reward: RewardState;
};
