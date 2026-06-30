import path from "node:path";
import url from "node:url";
import { render } from "ink";
import { run } from "./agent";
import { App } from "../../output";

const input = "";
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, "logs");

render(
  <App
    input={input}
    run={run}
    logDir={logDir}
    logFormat="pretty"
    runName="lesson8"
  />,
);
