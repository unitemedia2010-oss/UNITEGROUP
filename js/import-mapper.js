"use strict";

(() => {
  const EXPECTED_SHEET = "Danh sách nhân viên";
  const HEADER_ROW_INDEX = 6; // Dòng 7 trong Excel
  const DATA_START_INDEX = 7; // Dòng 8 trong Excel

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
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
    const value = text(raw).toLowerCase();
    if (value.includes("đang làm")) return "active";
    if (value.includes("đã nghỉ")) return "resigned";
    if (value.includes("bảo lưu")) return "reserved";
    return "unknown";
  }

  function normalizedRole(level, department, teamRaw) {
    const l = text(level).toLowerCase();
    const d = text(department).toLowerCase();
    const t = text(teamRaw).toLowerCase();
    if (d === "hr") return "HR";
    if (d === "admin") return "ADMIN";
    if (l.includes("qlcn")) return "BRANCH_MANAGER";
    if (l.includes("leader")) return "LEADER";
    if (l.includes("tpkd")) return "AREA_MANAGER";
    if (d === "kinh doanh") return "SALE";
    if (l.includes("tts") || l.includes("tv")) return "TTS";
    if (t.includes("tổng giám đốc") || t.includes("phó tổng") || d === "blđ") return "ADMIN";
    return "EMPLOYEE";
  }

  function normalizeRow(row, rowNumber, fileName) {
    const teamBranch = splitTeamBranch(row[6]);
    const workEmail = email(row[26]);
    const personalEmail = email(row[27]);
    const employeeCode = text(row[1]).toUpperCase();
    const fullName = text(row[2]);
    const department = text(row[3]);
    const area = text(row[5]);
    const level = text(row[7]);
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
      phone: text(row[28]) || null,
      department: department || null,
      area: area || null,
      branch: teamBranch.branch || null,
      team: teamBranch.team || null,
      title: (teamBranch.team ? level : text(row[6])) || null,
      employment_level: level || null,
      employment_type: text(row[8]) || null,
      gender: text(row[9]) || null,
      nickname: text(row[14]) || null,
      start_date: excelDate(row[4]),
      official_date: excelDate(row[40]),
      end_date: excelDate(row[45]),
      employment_status: employmentStatus(row[44]),
      photo_url: text(row[48]) || null,
      suggested_role: normalizedRole(level, department, row[6]),
      private_data: {
        birth_date: excelDate(row[10]),
        ethnicity: text(row[15]) || null,
        religion: text(row[16]) || null,
        nationality: text(row[17]) || null,
        citizen_id: text(row[18]) || null,
        social_insurance_no: text(row[19]) || null,
        tax_code: text(row[20]) || null,
        address_line: text(row[29]) || null,
        district: text(row[30]) || null,
        province: text(row[31]) || null,
        starting_salary: numberValue(row[32]),
        current_salary: numberValue(row[33]),
        bank_account: text(row[34]) || null,
        bank_name: text(row[35]) || null,
        probation_start: excelDate(row[36]),
        probation_end: excelDate(row[37]),
        probation_status: text(row[38]) || null,
        related_documents: text(row[39]) || null,
        official_contract_type: text(row[41]) || null,
        contract_expiry: excelDate(row[42]),
        contract_file_url: text(row[43]) || null,
        handover_status: text(row[46]) || null,
        handover_date: excelDate(row[47])
      },
      warnings
    };
  }

  async function parseFile(file) {
    if (!window.XLSX) throw new Error("Không tải được thư viện đọc Excel.");
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames.includes(EXPECTED_SHEET)
      ? EXPECTED_SHEET
      : workbook.SheetNames.find(name => /nhân viên/i.test(name));
    if (!sheetName) throw new Error(`Không tìm thấy sheet “${EXPECTED_SHEET}”.`);

    const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, defval: null, raw: true, blankrows: false
    });
    if (matrix.length <= DATA_START_INDEX) throw new Error("File không có dữ liệu nhân sự.");

    const rows = matrix.slice(DATA_START_INDEX)
      .map((row, index) => normalizeRow(row, DATA_START_INDEX + index + 1, file.name))
      .filter(row => row.full_name);

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
      teams: teams.length
    };

    return { sheetName, rows, summary, dimensions: { departments, areas, branches, teams } };
  }

  window.UWSImportMapper = { parseFile, normalizeRow, splitTeamBranch };
})();
