if (import.meta.env.DEV) {
  import("react-grab");
}

import { start } from "./studio-shell/boot";

void start();
