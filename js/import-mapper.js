"use strict";

(() => {
  const EXPECTED_SHEET = "Danh sách nhân viên";

  const FALLBACK = {
    employee_code: 1,
    full_name: 2,
    department: 3,
    start_date: 4,
    area: 5,
    team_branch_or_title: 6,
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
    employee_code: ["ma so nv", "ma nv", "ma nhan vien", "ma nhan su"],
    full_name: ["ho va ten", "ho ten", "ten nhan vien"],
    department: ["phong ban", "bo phan"],
    start_date: ["ngay bat dau", "ngay vao lam", "ngay bat dau lam"],
    area: ["cum hd", "cum hoat dong", "khu vuc", "cum"],
    team_branch_or_title: ["team chi nhanh", "team - chi nhanh", "team va chi nhanh", "chuc danh team chi nhanh", "chuc danh"],
    employment_level: ["cap bac", "level"],
    employment_type: ["loai cong viec", "hinh thuc lam viec"],
    gender: ["gioi tinh", "phai"],
    birth_date: ["ngay sinh"],
    nickname: ["nick name", "nickname", "ten goi"],
    ethnicity: ["dan toc"],
    religion: ["ton giao"],
    nationality: ["quoc tich"],
    citizen_id: ["so cccd", "cccd", "cmnd"],
    social_insurance_no: ["so bhxh", "bhxh"],
    tax_code: ["ma so thue", "mst"],
    work_email: ["email cong viec", "email company"],
    personal_email: ["email ca nhan", "email personal"],
    phone: ["so dien thoai", "dien thoai", "sdt"],
    address_line: ["so duong", "dia chi"],
    district: ["huyen quan", "quan huyen"],
    province: ["tinh tp", "tinh thanh pho", "tinh thanh"],
    starting_salary: ["luong khoi diem"],
    current_salary: ["luong hien tai"],
    bank_account: ["so tai khoan", "stk"],
    bank_name: ["ngan hang", "ten ngan hang"],
    probation_start: ["ngay thu viec"],
    probation_end: ["ngay ket thuc thu viec"],
    probation_status: ["trang thai thu viec"],
    related_documents: ["ho so lien quan"],
    official_date: ["ngay chinh thuc"],
    official_contract_type: ["loai hop dong"],
    contract_expiry: ["ngay het han hop dong"],
    contract_file_url: ["link file hop dong"],
    employment_status: ["tinh trang", "trang thai cong viec", "tinh trang cong viec"],
    end_date: ["ngay nghi viec", "ngay nghi"],
    handover_status: ["tinh trang ban giao"],
    handover_date: ["ngay ban giao"],
    photo_url: ["anh nhan vien", "hinh nhan vien"]
  };

  const DEPARTMENT_MAP = new Map([
    ["kinh doanh", "Kinh Doanh"], ["ke toan", "Kế Toán"], ["marketing", "Marketing"],
    ["hr", "HR"], ["admin", "Admin"], ["bld", "BLĐ"], ["ban lanh dao", "BLĐ"],
    ["tro ly", "Trợ Lý"], ["bao ve", "Bảo Vệ"], ["central real", "Central Real"]
  ]);
  const AREA_MAP = new Map([
    ["tinh hoa", "Tinh Hoa"], ["ky tai", "Kỳ Tài"], ["tien phong", "Tiên Phong"],
    ["khai pha", "Khai Phá"], ["buc pha", "Bức Phá"]
  ]);
  const EMPLOYMENT_TYPE_MAP = new Map([
    ["full time", "Full Time"], ["fulltime", "Full Time"],
    ["part time", "Part Time"], ["parttime", "Part Time"], ["ctv", "CTV"]
  ]);
  const BANK_MAP = new Map([
    ["acb", "ACB"], ["sacombank", "Sacombank"], ["mb", "MB Bank"], ["mb bank", "MB Bank"],
    ["mb bak", "MB Bank"], ["vietcombank", "Vietcombank"], ["vcb", "Vietcombank"],
    ["techcombank", "Techcombank"], ["techcom", "Techcombank"], ["tcb", "Techcombank"],
    ["tpbank", "TPBank"], ["tp bank", "TPBank"], ["vietinbank", "VietinBank"],
    ["viettinbank", "VietinBank"], ["bidv", "BIDV"], ["bidv bank", "BIDV"],
    ["vpbank", "VPBank"], ["vp bank", "VPBank"], ["vib", "VIB"],
    ["timo", "Timo"], ["timo bank", "Timo"], ["vikki bank", "Vikki Bank"]
  ]);

  function text(value) {
    return value === null || value === undefined ? "" : String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function stripAccents(value) {
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  }

  function key(value) {
    return stripAccents(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function headerMatches(value, aliases) {
    const normalized = key(value);
    if (!normalized || normalized === "ref") return false;
    return aliases.some(alias => {
      const target = key(alias);
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    });
  }

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value ?? "");
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function titleCaseVi(value) {
    const raw = text(value).toLocaleLowerCase("vi");
    return raw.replace(/(^|[\s(/-])([\p{L}])/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("vi")}`);
  }

  function canonicalMapped(value, mapping, fallback = titleCaseVi) {
    const raw = text(value);
    if (!raw) return "";
    return mapping.get(key(raw)) || fallback(raw);
  }

  function canonicalDepartment(value) { return canonicalMapped(value, DEPARTMENT_MAP); }
  function canonicalArea(value) { return canonicalMapped(value, AREA_MAP); }
  function canonicalEmploymentType(value) { return canonicalMapped(value, EMPLOYMENT_TYPE_MAP); }
  function canonicalBank(value) { return canonicalMapped(value, BANK_MAP); }
  function canonicalBranch(value) { return text(value).toLocaleUpperCase("vi"); }

  function canonicalTeam(value) {
    return text(value).toLocaleUpperCase("vi");
  }

  function email(value) {
    const result = text(value).toLowerCase();
    return /^\S+@\S+\.\S+$/.test(result) ? result : "";
  }

  function digits(value) {
    return text(value).replace(/[^0-9+]/g, "");
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
    if (parts.length < 2) return { team: "", branch: "" };
    return {
      team: canonicalTeam(parts.slice(0, -1).join(" - ")),
      branch: canonicalBranch(parts.at(-1))
    };
  }

  function employmentStatus(raw) {
    const value = key(raw);
    if (value.includes("dang lam")) return "active";
    if (value.includes("da nghi") || value.includes("nghi viec")) return "resigned";
    if (value.includes("bao luu")) return "reserved";
    return "unknown";
  }

  function personnelGroup(employeeCode) {
    const code = text(employeeCode).toUpperCase();
    if (!code) return "no_code";
    if (/^TVU/.test(code)) return "probation";
    if (/^U/.test(code)) return "official";
    return "other";
  }

  function normalizedRole(level, department, teamRaw) {
    const l = key(level);
    const d = key(department);
    const t = key(teamRaw);
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

  function findHeaderRow(matrix) {
    const max = Math.min(matrix.length, 25);
    for (let i = 0; i < max; i++) {
      const keys = (matrix[i] || []).map(key);
      const hasCode = keys.some(value => headerMatches(value, HEADER_ALIASES.employee_code));
      const hasName = keys.some(value => headerMatches(value, HEADER_ALIASES.full_name));
      if (hasCode && hasName) return i;
    }
    return 6;
  }

  function buildColumnMap(headerRow, sampleRows = []) {
    const normalized = (headerRow || []).map(key);
    const map = { ...FALLBACK };
    const detected = new Set();
    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      const index = normalized.findIndex(value => headerMatches(value, aliases));
      if (index >= 0) {
        map[field] = index;
        detected.add(field);
      }
    });

    // Một số file cũ có tiêu đề lỗi #REF! ở cột Giới tính. Chỉ suy đoán khi
    // dữ liệu mẫu đủ rõ để tránh tự gán nhầm cột.
    const columnCount = Math.max(headerRow?.length || 0, ...sampleRows.map(row => row?.length || 0));
    const bestColumn = (predicate, minimumMatches = 3, minimumRatio = 0.6) => {
      let best = null;
      for (let column = 0; column < columnCount; column++) {
        let nonEmpty = 0;
        let matches = 0;
        sampleRows.forEach(row => {
          const value = text(row?.[column]);
          if (!value) return;
          nonEmpty++;
          if (predicate(value)) matches++;
        });
        const ratio = nonEmpty ? matches / nonEmpty : 0;
        if (matches >= minimumMatches && ratio >= minimumRatio && (!best || matches > best.matches || (matches === best.matches && ratio > best.ratio))) {
          best = { column, matches, ratio };
        }
      }
      return best?.column ?? -1;
    };

    if (!detected.has("gender")) {
      const inferred = bestColumn(value => ["nam", "nu", "nữ", "male", "female"].includes(key(value)), 4, 0.75);
      if (inferred >= 0) map.gender = inferred;
    }
    if (!detected.has("employment_status")) {
      const inferred = bestColumn(value => /^(dang lam|da nghi|bao luu|nghi viec)$/.test(key(value)), 4, 0.55);
      if (inferred >= 0) map.employment_status = inferred;
    }
    if (!detected.has("team_branch_or_title") && detected.has("employment_level") && map.employment_level > 0) {
      map.team_branch_or_title = map.employment_level - 1;
    }

    // Xác nhận các cột quan trọng bằng dữ liệu mẫu, không chỉ dựa vào tiêu đề.
    const statusCandidate = bestColumn(value => /dang lam|da nghi|bao luu|nghi viec/.test(key(value)), 4, 0.55);
    if (statusCandidate >= 0) map.employment_status = statusCandidate;
    const bankCandidate = bestColumn(value => /acb|sacombank|mb bank|vietcombank|techcombank|tpbank|vietinbank|bidv|vpbank|vib|timo/.test(key(value)), 4, 0.45);
    if (!detected.has("bank_name") && bankCandidate >= 0) map.bank_name = bankCandidate;
    const emailColumns = [];
    for (let column = 0; column < columnCount; column++) {
      let matches = 0;
      sampleRows.forEach(row => { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(row?.[column]))) matches++; });
      if (matches >= 3) emailColumns.push({ column, matches });
    }
    emailColumns.sort((a,b) => b.matches - a.matches || a.column - b.column);
    if (!detected.has("personal_email") && emailColumns[0]) map.personal_email = emailColumns[0].column;
    if (!detected.has("work_email") && emailColumns[1]) map.work_email = emailColumns[1].column;

    return map;
  }

  function get(row, columnMap, field) {
    const index = columnMap[field];
    return Number.isInteger(index) ? row[index] : null;
  }

  function normalizeRow(row, rowNumber, fileName, columnMap = FALLBACK) {
    const rawDepartment = get(row, columnMap, "department");
    const department = canonicalDepartment(rawDepartment);
    const rawTeamBranchTitle = get(row, columnMap, "team_branch_or_title");
    const teamBranch = department === "Kinh Doanh" ? splitTeamBranch(rawTeamBranchTitle) : { team: "", branch: "" };
    const workEmail = email(get(row, columnMap, "work_email"));
    const personalEmail = email(get(row, columnMap, "personal_email"));
    const employeeCode = text(get(row, columnMap, "employee_code")).toUpperCase();
    const fullName = titleCaseVi(get(row, columnMap, "full_name"));
    const area = canonicalArea(get(row, columnMap, "area"));
    const level = text(get(row, columnMap, "employment_level"));
    const title = teamBranch.team ? level : titleCaseVi(rawTeamBranchTitle);
    const birthDate = excelDate(get(row, columnMap, "birth_date"));
    const phone = digits(get(row, columnMap, "phone"));
    const warnings = [];

    if (!fullName) warnings.push("Thiếu họ tên");
    if (!employeeCode) warnings.push("Thiếu mã nhân sự");
    if (!workEmail && !personalEmail) warnings.push("Thiếu email hợp lệ");
    if (!department) warnings.push("Thiếu phòng ban");
    if (department === "Kinh Doanh" && !area) warnings.push("Thiếu khu vực/cụm");
    if (department === "Kinh Doanh" && !teamBranch.team && !/(qlcn|tpkd)/i.test(level)) warnings.push("Thiếu team hoặc chi nhánh");

    const identitySources = [employeeCode ? "employee_code" : "", workEmail ? "work_email" : "", personalEmail ? "personal_email" : "", phone ? "phone" : "", birthDate ? "name_birth" : ""].filter(Boolean);
    const identityStrength = employeeCode ? "strong" : (workEmail || personalEmail || phone) ? "medium" : birthDate ? "weak" : "very_weak";
    if (identityStrength === "very_weak") warnings.push("Định danh yếu: thiếu mã, email, điện thoại và ngày sinh");
    const sourceFingerprint = stableHash([employeeCode, fullName, workEmail, personalEmail, phone, birthDate, department, area, teamBranch.branch, teamBranch.team].map(key).join("|"));

    return {
      row_number: rowNumber,
      source_file: fileName,
      source_sheet: EXPECTED_SHEET,
      employee_code: employeeCode || null,
      full_name: fullName,
      work_email: workEmail || null,
      personal_email: personalEmail || null,
      phone: phone || null,
      department: department || null,
      area: area || null,
      branch: teamBranch.branch || null,
      team: teamBranch.team || null,
      title: title || null,
      employment_level: level || null,
      employment_type: canonicalEmploymentType(get(row, columnMap, "employment_type")) || null,
      gender: titleCaseVi(get(row, columnMap, "gender")) || null,
      nickname: titleCaseVi(get(row, columnMap, "nickname")) || null,
      start_date: excelDate(get(row, columnMap, "start_date")),
      official_date: excelDate(get(row, columnMap, "official_date")),
      end_date: excelDate(get(row, columnMap, "end_date")),
      employment_status: employmentStatus(get(row, columnMap, "employment_status")),
      photo_url: text(get(row, columnMap, "photo_url")) || null,
      suggested_role: normalizedRole(level, department, rawTeamBranchTitle),
      personnel_group: personnelGroup(employeeCode),
      identity_key: employeeCode || workEmail || personalEmail || (phone ? `${key(fullName)}|${phone}` : birthDate ? `${key(fullName)}|${birthDate}` : `${key(fullName)}|row:${rowNumber}`),
      identity_sources: identitySources,
      identity_strength: identityStrength,
      source_fingerprint: sourceFingerprint,
      private_data: {
        birth_date: birthDate,
        ethnicity: titleCaseVi(get(row, columnMap, "ethnicity")) || null,
        religion: titleCaseVi(get(row, columnMap, "religion")) || null,
        nationality: titleCaseVi(get(row, columnMap, "nationality")) || null,
        citizen_id: text(get(row, columnMap, "citizen_id")) || null,
        social_insurance_no: text(get(row, columnMap, "social_insurance_no")) || null,
        tax_code: text(get(row, columnMap, "tax_code")) || null,
        address_line: text(get(row, columnMap, "address_line")) || null,
        district: titleCaseVi(get(row, columnMap, "district")) || null,
        province: titleCaseVi(get(row, columnMap, "province")) || null,
        starting_salary: numberValue(get(row, columnMap, "starting_salary")),
        current_salary: numberValue(get(row, columnMap, "current_salary")),
        bank_account: text(get(row, columnMap, "bank_account")) || null,
        bank_name: canonicalBank(get(row, columnMap, "bank_name")) || null,
        probation_start: excelDate(get(row, columnMap, "probation_start")),
        probation_end: excelDate(get(row, columnMap, "probation_end")),
        probation_status: titleCaseVi(get(row, columnMap, "probation_status")) || null,
        related_documents: text(get(row, columnMap, "related_documents")) || null,
        official_contract_type: titleCaseVi(get(row, columnMap, "official_contract_type")) || null,
        contract_expiry: excelDate(get(row, columnMap, "contract_expiry")),
        contract_file_url: text(get(row, columnMap, "contract_file_url")) || null,
        handover_status: titleCaseVi(get(row, columnMap, "handover_status")) || null,
        handover_date: excelDate(get(row, columnMap, "handover_date"))
      },
      warnings
    };
  }

  function addDuplicateWarnings(rows, selector, label) {
    const groups = new Map();
    rows.forEach((row, index) => {
      const value = selector(row);
      if (!value) return;
      const normalized = key(value);
      if (!groups.has(normalized)) groups.set(normalized, []);
      groups.get(normalized).push(index);
    });
    groups.forEach(indexes => {
      if (indexes.length < 2) return;
      indexes.forEach(index => rows[index].warnings.push(`${label} bị trùng trong file`));
    });
  }

  function addHierarchyWarnings(rows) {
    const teamPaths = new Map();
    rows.forEach((row, index) => {
      if (!row.team) return;
      const teamKey = key(row.team);
      const path = [row.department, row.area, row.branch].map(value => key(value)).join("|");
      if (!teamPaths.has(teamKey)) teamPaths.set(teamKey, new Map());
      const pathMap = teamPaths.get(teamKey);
      if (!pathMap.has(path)) pathMap.set(path, []);
      pathMap.get(path).push(index);
    });
    teamPaths.forEach((pathMap, teamKey) => {
      if (pathMap.size <= 1) return;
      const readable = [...pathMap.values()].flat().map(index => rows[index]);
      readable.forEach(row => row.warnings.push(`Team ${row.team} đang xuất hiện ở nhiều tuyến Khu vực/Chi nhánh`));
    });
  }

  async function parseFile(file) {
    if (!window.XLSX) throw new Error("Không tải được thư viện đọc Excel.");
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames.includes(EXPECTED_SHEET)
      ? EXPECTED_SHEET
      : workbook.SheetNames.find(name => /nhân viên/i.test(name))
        || (workbook.SheetNames.length === 1 ? workbook.SheetNames[0] : null);
    if (!sheetName) throw new Error(`Không tìm thấy sheet “${EXPECTED_SHEET}” và file có nhiều sheet không xác định.`);

    const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, defval: null, raw: true, blankrows: true
    });
    const headerRowIndex = findHeaderRow(matrix);
    const dataStartIndex = headerRowIndex + 1;
    if (matrix.length <= dataStartIndex) throw new Error("File không có dữ liệu nhân sự.");
    const columnMap = buildColumnMap(matrix[headerRowIndex] || [], matrix.slice(dataStartIndex, dataStartIndex + 80));

    const rows = matrix.slice(dataStartIndex)
      .map((row, index) => normalizeRow(row, dataStartIndex + index + 1, file.name, columnMap))
      .filter(row => row.full_name);

    addDuplicateWarnings(rows, row => row.employee_code, "Mã nhân sự");
    addDuplicateWarnings(rows, row => row.work_email, "Email công việc");
    addDuplicateWarnings(rows, row => row.personal_email, "Email cá nhân");
    addDuplicateWarnings(rows, row => row.phone, "Số điện thoại");
    addHierarchyWarnings(rows);

    const departments = [...new Set(rows.map(row => row.department).filter(Boolean))].sort((a,b) => a.localeCompare(b,"vi"));
    const areas = [...new Set(rows.map(row => row.area).filter(Boolean))].sort((a,b) => a.localeCompare(b,"vi"));
    const branches = [...new Set(rows.map(row => row.branch).filter(Boolean))].sort((a,b) => a.localeCompare(b,"vi"));
    const teams = [...new Set(rows.map(row => row.team).filter(Boolean))].sort((a,b) => a.localeCompare(b,"vi"));
    const hierarchyConflictRows = rows.filter(row => row.warnings.some(warning => warning.includes("nhiều tuyến"))).length;
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
      hierarchy_conflict_rows: hierarchyConflictRows,
      strong_identity_rows: rows.filter(row => row.identity_strength === "strong").length,
      weak_identity_rows: rows.filter(row => ["weak","very_weak"].includes(row.identity_strength)).length,
      safe_rows: rows.filter(row => !row.warnings.some(warning => /bị trùng trong file$/i.test(warning))).length,
      header_row: headerRowIndex + 1,
      data_start_row: dataStartIndex + 1
    };

    return { sheetName, rows, summary, dimensions: { departments, areas, branches, teams }, columnMap };
  }

  window.UWSImportMapper = {
    parseFile,
    normalizeRow,
    splitTeamBranch,
    personnelGroup,
    canonicalDepartment,
    canonicalArea,
    canonicalEmploymentType,
    canonicalBank,
    titleCaseVi
  };
})();
