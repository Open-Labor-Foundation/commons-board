export type ValidationCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

export type TestingAgentReport = {
  status: "pass" | "fail";
  summary: string;
  failed_tests: string[];
  metrics: {
    total_tests: number;
    passed: number;
    failed: number;
  };
};
