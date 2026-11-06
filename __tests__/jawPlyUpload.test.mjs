import fs from "node:fs";

const preview = fs.readFileSync("src/js/2D/preview3D.js", "utf8");
const createCase = fs.readFileSync("src/js/pages/createCase.js", "utf8");
const caseList = fs.readFileSync("src/pages/case_list.html", "utf8");
const adminCaseList = fs.readFileSync("src/pages/admin/admin_case_list.html", "utf8");

describe("PLY jaw uploads", () => {
  test("2D Preview accepts PLY but stores its DLL-compatible STL normalization", () => {
    const upload = preview.slice(
      preview.indexOf("function pickAndUploadJawStl"),
      preview.indexOf("// Jaw trash button")
    );
    expect(upload).toContain('".stl,.ply"');
    expect(upload).toContain("isSupportedMeshFile(file.name)");
    expect(upload).toContain("normalizeJawMeshFile(file, PLYLoader)");
  });

  test("case creation accepts PLY from both picker and drop", () => {
    expect(caseList).toContain('id="jawUploadInput" accept=".stl,.ply"');
    expect(adminCaseList).toContain('id="jawUploadInput" accept=".stl,.ply"');
    expect(createCase).toContain("isSupportedMeshFile(file.name)");
    expect(createCase).toContain("normalizeJawMeshFile(file, PLYLoader)");
  });
});
