export type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};
