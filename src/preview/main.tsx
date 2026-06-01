import "./chrome-mock"; // precisa rodar antes do App tocar em chrome.*
import { render } from "preact";
import { App } from "../sidepanel/App";
import "../sidepanel/styles.css";

const root = document.getElementById("app");
if (root) render(<App />, root);
