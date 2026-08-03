import assert from "node:assert/strict";
import { parseManualListCsv } from "../src/lib/groundswell/manual-list-csv.ts";

const csv = `empresa,cargo,nome,linkedin
Acme,CMO,Ana Silva,https://www.linkedin.com/in/ana-silva/
Acme,CEO,Sem Perfil,não encontrado`;

const result = parseManualListCsv(csv);
assert.equal(result.rows.length, 1);
assert.equal(result.errors.length, 1);
assert.deepEqual(result.rows[0], {
  name: "Ana Silva",
  linkedin_url: "https://www.linkedin.com/in/ana-silva",
  headline: "CMO",
  current_company: "Acme",
});
console.log("manual-list-csv: ok");
