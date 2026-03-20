
declare const GEMINI_API_KEY: string;
declare const DEEPSEEK_API_KEY: string;

declare interface Process {
  env: {
    GEMINI_API_KEY: string;
    DEEPSEEK_API_KEY: string;
    [key: string]: string | undefined;
  };
}

declare const process: Process;
