"use strict";

(() => {
  const EXPECTED_SHEET = "Danh sách nhân viên";
  const HEADER_ROW_INDEX = 6; // Dòng 7 trong Excel
  const DATA_START_INDEX = 7; // Dòng 8 trong Excel
  const FALLBACK_INDEX = {
    employee_code: 1,
    full_name: 2,
    department: 3,
    start_date: 4,
    area: 5,
    title_or_team_branch: 6,
    employment_level: 7,
    employment_type: 8,
    gender: 9,
    birth_date: 10,
    nickname: 14,
    ethnicity: 15,
    religion: 16,
    nationality: 17,
    citizen_id: 18,
    social_insurance_no: 19,
    tax_code: 20,
    work_email: 26,
    personal_email: 27,
    phone: 28,
    address_line: 29,
    district: 30,
    province: 31,
    starting_salary: 32,
    current_salary: 33,
    bank_account: 34,
    bank_name: 35,
    probation_start: 36,
    probation_end: 37,
    probation_status: 38,
    related_documents: 39,
    official_date: 40,
    official_contract_type: 41,
    contract_expiry: 42,
    contract_file_url: 43,
    employment_status: 44,
    end_date: 45,
    handover_status: 46,
    handover_date: 47,
    photo_url: 48
  };
  const HEADER_ALIASES = {
    employee_code: ["ma so nv", "ma nv", "msnv", "employee code", "employee id"],
    full_name: ["ho va ten", "ho ten", "ten nhan vien", "full name"],
    department: ["phong ban", "bo phan", "department"],
    start_date: ["ngay bat dau", "ngay vao", "ngay vao lam", "start date"],
    area: ["cum hd", "cum hđ", "khu vuc", "khu vuc/cum", "area"],
    title_or_team_branch: ["chuc danh", "vi tri", "team - chi nhanh", "team/chi nhanh", "title"],
    employment_level: ["cap bac", "bac", "level"],
    employment_type: ["loai cong viec", "loai nhan vien", "loai nv", "employment type"],
    gender: ["gioi tinh", "gender"],
    birth_date: ["ngay sinh", "date of birth", "dob"],
    nickname: ["nick name", "nickname", "ten nick", "biet danh"],
    ethnicity: ["dan toc"],
    religion: ["ton giao"],
    nationality: ["quoc tich"],
    citizen_id: ["cccd", "cmnd", "can cuoc", "so cccd"],
    social_insurance_no: ["bhxh", "bao hiem xa hoi"],
    tax_code: ["ma so thue", "mst"],
    work_email: ["email cong viec", "email unite", "email cty", "work email"],
    personal_email: ["email ca nhan", "personal email"],
    phone: ["dien thoai", "so dien thoai", "sdt", "phone"],
    address_line: ["dia chi", "dia chi thuong tru"],
    district: ["quan huyen", "huyen"],
    province: ["tinh thanh", "tinh/tp", "province"],
    starting_salary: ["luong khoi diem"],
    current_salary: ["luong hien tai"],
    bank_account: ["so tai khoan", "stk", "account number", "bank account"],
    bank_name: ["ngan hang", "ma ngan hang", "bank", "bank name"],
    probation_start: ["thu viec tu ngay", "ngay bat dau thu viec"],
    probation_end: ["thu viec den ngay", "ngay ket thuc thu viec"],
    probation_status: ["trang thai thu viec"],
    related_documents: ["giay to lien quan", "ho so lien quan"],
    official_date: ["ngay chinh thuc"],
    official_contract_type: ["loai hop dong", "hinh thuc hop dong"],
    contract_expiry: ["het han hop dong", "ngay het han hd"],
    contract_file_url: ["file hop dong", "link hop dong"],
    employment_status: ["trang thai", "tinh trang", "dang lam/da nghi"],
    end_date: ["ngay nghi", "ngay ket thuc"],
    handover_status: ["ban giao"],
    handover_date: ["ngay ban giao"],
    photo_url: ["hinh anh", "anh", "photo"]
  };

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function fold(value) {
    return text(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokens(value) {
    return fold(value).split(" ").filter(token => token.length > 1);
  }

  function headerMatchScore(header, alias) {
    if (!header || !alias) return 0;
    if (header === alias) return 100;
    if (header.includes(alias)) return Math.max(74, 92 - Math.max(0, header.length - alias.length));
    if (alias.includes(header) && header.length >= 4) return 70;
    const headerTokens = new Set(tokens(header));
    const aliasTokens = tokens(alias);
    if (!headerTokens.size || !aliasTokens.length) return 0;
    const matched = aliasTokens.filter(token => headerTokens.has(token)).length;
    const coverage = matched / aliasTokens.length;
    const density = matched / headerTokens.size;
    return Math.round((coverage * 58) + (density * 24));
  }

  function bestHeaderMatch(aliases, foldedHeaders) {
    let best = { index: -1, score: 0 };
    foldedHeaders.forEach(header => {
      aliases.forEach(alias => {
        const score = headerMatchScore(header.key, fold(alias));
        if (score > best.score) best = { index: header.index, score };
      });
    });
    return best;
  }

  function titleCase(value) {
    const raw = text(value).replace(/\s+/g, " ");
    if (!raw) return "";
    return raw.toLocaleLowerCase("vi").replace(/(^|[\s-/])([^\s-/])/g, (_, prefix, char) => `${prefix}${char.toLocaleUpperCase("vi")}`);
  }

  function canonicalText(value, field = "") {
    const raw = text(value).replace(/\s+/g, " ");
    if (!raw) return "";
    const key = fold(raw);
    const special = {
      "hr": "HR",
      "admin": "Admin",
      "bld": "BLĐ",
      "ban lanh dao": "BLĐ",
      "kinh doanh": "Kinh Doanh",
      "tinh hoa": "Tinh Hoa",
      "ky tai": "Kỳ Tài",
      "tien phong": "Tiên Phong",
      "buc pha": "Bức Phá",
      "but pha": "Bức Phá",
      "khai pha": "Khai Phá",
      "full time": "Full Time",
      "part time": "Part Time",
      "ctv": "CTV",
      "tts": "TTS",
      "nvpt": "NVPT",
      "ontop": "ONTOP",
      "one": "O.N.E",
      "o n e": "O.N.E"
    }[key];
    if (special) return special;
    if (field === "employee_code") return raw.toUpperCase();
    if (field === "bank" && /^[a-z0-9]{2,12}$/i.test(raw)) return raw.toUpperCase();
    if (field === "branch" && /^[a-z0-9]{2,6}$/i.test(raw)) return raw.toUpperCase();
    if (field === "team" && (/^[a-z0-9.]{2,6}$/i.test(raw) || raw === raw.toUpperCase())) return raw.toUpperCase();
    if (field === "full_name" && raw === raw.toUpperCase()) return titleCase(raw);
    return raw;
  }

  function findHeaderRow(matrix) {
    const maxRows = Math.min(matrix.length, 16);
    let bestRow = { index: HEADER_ROW_INDEX, score: 0 };
    for (let index = 0; index < maxRows; index += 1) {
      const headers = (matrix[index] || [])
        .map((value, columnIndex) => ({ key: fold(value), index: columnIndex }))
        .filter(header => header.key);
      const code = bestHeaderMatch(HEADER_ALIASES.employee_code, headers).score;
      const name = bestHeaderMatch(HEADER_ALIASES.full_name, headers).score;
      const department = bestHeaderMatch(HEADER_ALIASES.department, headers).score;
      const score = code + name + (department * 0.45) + Math.min(headers.length, 16);
      if (code >= 70 && name >= 70) return index;
      if (score > bestRow.score) bestRow = { index, score };
    }
    return bestRow.score >= 120 ? bestRow.index : HEADER_ROW_INDEX;
  }

  function buildHeaderMap(headerRow) {
    const foldedHeaders = [];
    const usedIndexes = new Set();
    (headerRow || []).forEach((value, index) => {
      const key = fold(value);
      if (key) foldedHeaders.push({ key, index });
    });
    return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
      const match = bestHeaderMatch(aliases, foldedHeaders.filter(header => !usedIndexes.has(header.index)));
      if (match.score >= 52) {
        usedIndexes.add(match.index);
        return [field, match.index];
      }
      return [field, FALLBACK_INDEX[field]];
    }));
  }

  function cell(row, headerMap, field) {
    const index = headerMap[field] ?? FALLBACK_INDEX[field];
    return row[index];
  }

  function findDataStartIndex(matrix, headerRowIndex, headerMap) {
    for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      const code = fold(cell(row, headerMap, "employee_code"));
      const name = fold(cell(row, headerMap, "full_name"));
      const department = fold(cell(row, headerMap, "department"));
      const maybeHeader = code.includes("ma") && code.includes("nv") || name.includes("ho") && name.includes("ten");
      if (maybeHeader) continue;
      if (name && (code || department || email(cell(row, headerMap, "work_email")) || email(cell(row, headerMap, "personal_email")))) return index;
    }
    return headerRowIndex + 1;
  }

  function email(value) {
    const result = text(value).toLowerCase();
    return /^\S+@\S+\.\S+$/.test(result) ? result : "";
  }

  function excelDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return `${String(parsed.y).padStart(4,"0")}-${String(parsed.m).padStart(2,"0")}-${String(parsed.d).padStart(2,"0")}`;
      }
    }
    const raw = text(value);
    if (!raw) return null;
    const vi = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (vi) return `${vi[3]}-${vi[2].padStart(2,"0")}-${vi[1].padStart(2,"0")}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value).replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function splitTeamBranch(rawValue) {
    const raw = text(rawValue);
    if (!raw) return { team: "", branch: "" };
    const parts = raw.split(/\s+-\s+/);
    // Cột này trong file gốc đồng thời chứa chức danh (QLCN, Nhân viên, GĐ...)
    // và Team - Chi nhánh. Chỉ tách khi thật sự có dấu phân cách.
    if (parts.length < 2) return { team: "", branch: "" };
    return { team: parts.slice(0, -1).join(" - ").trim(), branch: parts.at(-1).trim() };
  }

  function employmentStatus(raw) {
    const value = fold(raw);
    if (value.includes("dang lam") || value === "active") return "active";
    if (value.includes("da nghi") || value.includes("nghi viec") || value === "resigned") return "resigned";
    if (value.includes("bao luu") || value === "reserved") return "reserved";
    return "unknown";
  }

  function normalizedRole(level, department, teamRaw) {
    const l = fold(level);
    const d = fold(department);
    const t = fold(teamRaw);
    if (d === "hr") return "HR";
    if (d === "admin") return "ADMIN";
    if (l.includes("qlcn")) return "BRANCH_MANAGER";
    if (l.includes("leader")) return "LEADER";
    if (l.includes("tpkd")) return "AREA_MANAGER";
    if (d === "kinh doanh") return "SALE";
    if (l.includes("tts") || l.includes("tv")) return "TTS";
    if (t.includes("tong giam doc") || t.includes("pho tong") || d === "bld") return "ADMIN";
    return "EMPLOYEE";
  }

  function normalizeRow(row, rowNumber, fileName, headerMap = FALLBACK_INDEX) {
    const titleSource = cell(row, headerMap, "title_or_team_branch");
    const teamBranch = splitTeamBranch(titleSource);
    const workEmail = email(cell(row, headerMap, "work_email"));
    const personalEmail = email(cell(row, headerMap, "personal_email"));
    const employeeCode = canonicalText(cell(row, headerMap, "employee_code"), "employee_code");
    const fullName = canonicalText(cell(row, headerMap, "full_name"), "full_name");
    const department = canonicalText(cell(row, headerMap, "department"), "department");
    const area = canonicalText(cell(row, headerMap, "area"), "area");
    const level = canonicalText(cell(row, headerMap, "employment_level"), "level");
    const warnings = [];

    if (!fullName) warnings.push("Thiếu họ tên");
    if (!employeeCode) warnings.push("Thiếu mã nhân sự");
    if (!workEmail && !personalEmail) warnings.push("Thiếu email hợp lệ");
    if (!department) warnings.push("Thiếu phòng ban");
    if (department.toLowerCase() === "kinh doanh" && !area) warnings.push("Thiếu khu vực/cụm");
    if (department.toLowerCase() === "kinh doanh" && !teamBranch.team && !/(qlcn|tpkd)/i.test(level)) warnings.push("Thiếu team");

    return {
      row_number: rowNumber,
      source_file: fileName,
      employee_code: employeeCode || null,
      full_name: fullName,
      work_email: workEmail || null,
      personal_email: personalEmail || null,
      phone: text(cell(row, headerMap, "phone")) || null,
      department: department || null,
      area: area || null,
      branch: canonicalText(teamBranch.branch, "branch") || null,
      team: canonicalText(teamBranch.team, "team") || null,
      title: (teamBranch.team ? level : canonicalText(titleSource, "title")) || null,
      employment_level: level || null,
      employment_type: canonicalText(cell(row, headerMap, "employment_type"), "type") || null,
      gender: canonicalText(cell(row, headerMap, "gender"), "gender") || null,
      nickname: canonicalText(cell(row, headerMap, "nickname"), "nickname") || null,
      start_date: excelDate(cell(row, headerMap, "start_date")),
      official_date: excelDate(cell(row, headerMap, "official_date")),
      end_date: excelDate(cell(row, headerMap, "end_date")),
      employment_status: employmentStatus(cell(row, headerMap, "employment_status")),
      photo_url: text(cell(row, headerMap, "photo_url")) || null,
      suggested_role: normalizedRole(level, department, titleSource),
      private_data: {
        birth_date: excelDate(cell(row, headerMap, "birth_date")),
        ethnicity: text(cell(row, headerMap, "ethnicity")) || null,
        religion: text(cell(row, headerMap, "religion")) || null,
        nationality: text(cell(row, headerMap, "nationality")) || null,
        citizen_id: text(cell(row, headerMap, "citizen_id")) || null,
        social_insurance_no: text(cell(row, headerMap, "social_insurance_no")) || null,
        tax_code: text(cell(row, headerMap, "tax_code")) || null,
        address_line: text(cell(row, headerMap, "address_line")) || null,
        district: canonicalText(cell(row, headerMap, "district"), "district") || null,
        province: canonicalText(cell(row, headerMap, "province"), "province") || null,
        starting_salary: numberValue(cell(row, headerMap, "starting_salary")),
        current_salary: numberValue(cell(row, headerMap, "current_salary")),
        bank_account: text(cell(row, headerMap, "bank_account")) || null,
        bank_name: canonicalText(cell(row, headerMap, "bank_name"), "bank") || null,
        probation_start: excelDate(cell(row, headerMap, "probation_start")),
        probation_end: excelDate(cell(row, headerMap, "probation_end")),
        probation_status: text(cell(row, headerMap, "probation_status")) || null,
        related_documents: text(cell(row, headerMap, "related_documents")) || null,
        official_contract_type: text(cell(row, headerMap, "official_contract_type")) || null,
        contract_expiry: excelDate(cell(row, headerMap, "contract_expiry")),
        contract_file_url: text(cell(row, headerMap, "contract_file_url")) || null,
        handover_status: text(cell(row, headerMap, "handover_status")) || null,
        handover_date: excelDate(cell(row, headerMap, "handover_date"))
      },
      warnings
    };
  }

  function splitDelimitedLine(line, delimiter) {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"') {
        if (quoted && next === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }

  function detectDelimiter(lines) {
    const candidates = [",", ";", "\t"];
    return candidates
      .map(delimiter => {
        const widths = lines.slice(0, 10).map(line => splitDelimitedLine(line, delimiter).length);
        const useful = widths.filter(width => width > 1);
        const maxWidth = Math.max(1, ...widths);
        const stability = useful.filter(width => width === maxWidth).length;
        return { delimiter, score: (maxWidth * 10) + stability + useful.length };
      })
      .sort((a, b) => b.score - a.score)[0].delimiter;
  }

  function parseDelimitedText(rawText) {
    const normalized = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n").filter(line => line.trim());
    if (!lines.length) return [];
    const delimiter = detectDelimiter(lines);
    return lines
      .map(line => splitDelimitedLine(line, delimiter).map(value => text(value)))
      .filter(row => row.some(Boolean));
  }

  function isCsvFile(file) {
    return /\.csv$/i.test(file?.name || "") || /csv/i.test(file?.type || "");
  }

  async function fileToMatrix(file) {
    if (isCsvFile(file)) {
      return {
        matrix: parseDelimitedText(await file.text()),
        sheetName: "CSV",
        sourceType: "csv"
      };
    }
    if (!window.XLSX) throw new Error("Không tải được thư viện đọc Excel.");
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames.includes(EXPECTED_SHEET)
      ? EXPECTED_SHEET
      : workbook.SheetNames.find(name => fold(name).includes("nhan vien"));
    if (!sheetName) throw new Error(`Không tìm thấy sheet “${EXPECTED_SHEET}”.`);
    return {
      matrix: window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1, defval: null, raw: true, blankrows: false
      }),
      sheetName,
      sourceType: "excel"
    };
  }

  async function parseFile(file) {
    const { matrix, sheetName, sourceType } = await fileToMatrix(file);
    if (matrix.length <= 1) throw new Error("File không có dữ liệu nhân sự.");

    const headerRowIndex = findHeaderRow(matrix);
    const headerMap = buildHeaderMap(matrix[headerRowIndex] || []);
    const dataStartIndex = findDataStartIndex(matrix, headerRowIndex, headerMap);
    const rows = matrix.slice(dataStartIndex)
      .map((row, index) => normalizeRow(row, dataStartIndex + index + 1, file.name, headerMap))
      .filter(row => row.full_name && fold(row.employee_code) !== fold("Mã số NV"));

    const codeCounts = new Map();
    rows.forEach(row => {
      if (!row.employee_code) return;
      codeCounts.set(row.employee_code, (codeCounts.get(row.employee_code) || 0) + 1);
    });
    rows.forEach(row => {
      if (row.employee_code && codeCounts.get(row.employee_code) > 1) row.warnings.push("Trùng mã nhân sự trong file");
    });

    const departments = [...new Set(rows.map(row => row.department).filter(Boolean))].sort();
    const areas = [...new Set(rows.map(row => row.area).filter(Boolean))].sort();
    const branches = [...new Set(rows.map(row => row.branch).filter(Boolean))].sort();
    const teams = [...new Set(rows.map(row => row.team).filter(Boolean))].sort();
    const summary = {
      total: rows.length,
      active: rows.filter(row => row.employment_status === "active").length,
      resigned: rows.filter(row => row.employment_status === "resigned").length,
      reserved: rows.filter(row => row.employment_status === "reserved").length,
      warning_rows: rows.filter(row => row.warnings.length).length,
      missing_code: rows.filter(row => !row.employee_code).length,
      missing_email: rows.filter(row => !row.work_email && !row.personal_email).length,
      departments: departments.length,
      areas: areas.length,
      branches: branches.length,
      teams: teams.length,
      source_type: sourceType
    };

    return { sheetName, sourceType, rows, summary, dimensions: { departments, areas, branches, teams } };
  }

  window.UWSImportMapper = { parseFile, normalizeRow, splitTeamBranch };
})();
