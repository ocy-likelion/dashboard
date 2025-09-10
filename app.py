import os
import sqlite3
from datetime import datetime, date
from typing import Any, Dict, List, Tuple

from flask import Flask, jsonify, request, render_template
from flask_cors import CORS


DB_PATH = os.path.join(os.path.dirname(__file__), 'kdt_dashboard.db')


def create_app() -> Flask:
    app = Flask(__name__, static_folder='static', template_folder='templates')
    CORS(app)

    # --------------------
    # DB Utilities
    # --------------------
    def get_db_connection() -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
        return cur.fetchone() is not None

    def get_table_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
        try:
            cur = conn.execute(f"PRAGMA table_info({table_name})")
            cols = [row['name'] for row in cur.fetchall()]
            return cols
        except Exception:
            return []

    def ensure_db():
        conn = get_db_connection()
        try:
            if not table_exists(conn, 'kdt_programs'):
                conn.execute(
                    """
                    CREATE TABLE kdt_programs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        과정코드 TEXT,
                        HRD_Net_과정명 TEXT,
                        과정명 TEXT,
                        회차 TEXT,
                        기수 TEXT,
                        배치 TEXT,
                        진행상태 TEXT,
                        개강일 TEXT,
                        종강일 TEXT,
                        개강 TEXT,
                        종강 TEXT,
                        년도 INTEGER,
                        분기 TEXT,
                        담당팀 TEXT,
                        팀 TEXT,
                        과정구분 TEXT,
                        교육시간 INTEGER,
                        정원 INTEGER,
                        HRD_확정 INTEGER,
                        중도이탈 INTEGER,
                        수료인원 INTEGER,
                        취업인원 INTEGER,
                        근로자 INTEGER,
                        취업산정제외인원 INTEGER,
                        "수료산정 제외인원" INTEGER,
                        제외 INTEGER,
                        HRD_만족도 REAL
                    )
                    """
                )
                conn.commit()
        finally:
            conn.close()

    ensure_db()

    # --------------------
    # Lightweight migration: rename column 산정제외 → 수료산정 제외인원
    # --------------------
    def migrate_schema():
        conn = get_db_connection()
        try:
            cols = get_table_columns(conn, 'kdt_programs')
            if '산정제외' in cols and '수료산정 제외인원' not in cols:
                try:
                    # Attempt simple rename (SQLite 3.25+)
                    conn.execute('ALTER TABLE kdt_programs RENAME COLUMN 산정제외 TO "수료산정 제외인원"')
                    conn.commit()
                except Exception:
                    # Rebuild table if rename not supported
                    conn.execute(
                        """
                        CREATE TABLE kdt_programs__new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            과정코드 TEXT,
                            HRD_Net_과정명 TEXT,
                            과정명 TEXT,
                            회차 TEXT,
                            기수 TEXT,
                            배치 TEXT,
                            진행상태 TEXT,
                            개강일 TEXT,
                            종강일 TEXT,
                            개강 TEXT,
                            종강 TEXT,
                            년도 INTEGER,
                            분기 TEXT,
                            담당팀 TEXT,
                            팀 TEXT,
                            과정구분 TEXT,
                            교육시간 INTEGER,
                            정원 INTEGER,
                            HRD_확정 INTEGER,
                            중도이탈 INTEGER,
                            수료인원 INTEGER,
                            취업인원 INTEGER,
                            근로자 INTEGER,
                            취업산정제외인원 INTEGER,
                            "수료산정 제외인원" INTEGER,
                            제외 INTEGER,
                            HRD_만족도 REAL
                        )
                        """
                    )
                    # Determine target column order
                    target_cols = get_table_columns(conn, 'kdt_programs__new')
                    # Build SELECT list mapping with proper identifier quoting
                    select_exprs = []
                    for c in target_cols:
                        if c == '수료산정 제외인원' and '산정제외' in cols:
                            select_exprs.append(f'{quote_ident("산정제외")} AS {quote_ident("수료산정 제외인원")}')
                        elif c in cols:
                            select_exprs.append(quote_ident(c))
                        else:
                            select_exprs.append(f'NULL AS {quote_ident(c)}')
                    insert_cols = ', '.join(quote_ident(c) for c in target_cols)
                    conn.execute(
                        f"INSERT INTO kdt_programs__new ({insert_cols}) SELECT {', '.join(select_exprs)} FROM kdt_programs"
                    )
                    conn.execute('DROP TABLE kdt_programs')
                    conn.execute('ALTER TABLE kdt_programs__new RENAME TO kdt_programs')
                    conn.commit()
        finally:
            conn.close()

    migrate_schema()

    # --------------------
    # Helpers for schema variance
    # --------------------
    def pick_first_existing(cols: List[str], candidates: List[str]) -> str:
        for c in candidates:
            if c in cols:
                return c
        return ''

    def get_schema_mapping(conn: sqlite3.Connection) -> Dict[str, str]:
        cols = get_table_columns(conn, 'kdt_programs')
        mapping = {
            'team': pick_first_existing(cols, ['담당팀', '팀', '과정구분']),
            'name': pick_first_existing(cols, ['HRD_Net_과정명', '과정명']),
            'batch': pick_first_existing(cols, ['기수', '배치']),
            'start': pick_first_existing(cols, ['개강일', '개강']),
            'end': pick_first_existing(cols, ['종강일', '종강']),
            'year': pick_first_existing(cols, ['년도']),
            'quarter': pick_first_existing(cols, ['분기']),
            'status': pick_first_existing(cols, ['진행상태']),
            'capacity': pick_first_existing(cols, ['정원']),
            'confirmed': pick_first_existing(cols, ['HRD_확정']),
            'completed': pick_first_existing(cols, ['수료인원']),
            'employed': pick_first_existing(cols, ['취업인원']),
            'satisfaction': pick_first_existing(cols, ['HRD_만족도']),
            'employment_excluded': pick_first_existing(cols, ['취업산정제외인원']),
            'workers': pick_first_existing(cols, ['근로자']),
            'complete_excluded': pick_first_existing(cols, ['수료산정 제외인원', '산정제외'])
        }
        return mapping

    def parse_int(value: Any, default: int = 0) -> int:
        try:
            if value is None:
                return default
            return int(value)
        except Exception:
            return default

    def parse_float(value: Any, default: float = 0.0) -> float:
        try:
            if value is None:
                return default
            return float(value)
        except Exception:
            return default

    def calc_kpis(rows: List[sqlite3.Row], mapping: Dict[str, str]) -> Dict[str, float]:
        total_capacity = 0
        total_confirmed = 0
        total_completed = 0
        total_employed = 0
        satisfaction_sum = 0.0
        satisfaction_count = 0
        total_emp_excl = 0
        total_workers = 0
        total_complete_excl = 0

        for r in rows:
            capacity = parse_int(r.get(mapping['capacity'])) if mapping['capacity'] else 0
            confirmed = parse_int(r.get(mapping['confirmed'])) if mapping['confirmed'] else 0
            completed = parse_int(r.get(mapping['completed'])) if mapping['completed'] else 0
            employed = parse_int(r.get(mapping['employed'])) if mapping['employed'] else 0
            satis = parse_float(r.get(mapping['satisfaction'])) if mapping['satisfaction'] else 0.0
            emp_excl = parse_int(r.get(mapping.get('employment_excluded'))) if mapping.get('employment_excluded') else 0
            workers = parse_int(r.get(mapping.get('workers'))) if mapping.get('workers') else 0
            comp_excl = parse_int(r.get(mapping.get('complete_excluded'))) if mapping.get('complete_excluded') else 0

            total_capacity += capacity
            total_confirmed += confirmed
            total_completed += completed
            total_employed += employed
            total_emp_excl += emp_excl
            total_workers += workers
            total_complete_excl += comp_excl
            if mapping['satisfaction'] and r.get(mapping['satisfaction']) is not None:
                satisfaction_sum += satis
                satisfaction_count += 1

        모집률 = (total_confirmed / total_capacity * 100) if total_capacity > 0 else 0.0

        # 수료율 = (수료인원) / (HRD_확정 - 수료산정 제외인원) * 100
        grad_den = total_confirmed - total_complete_excl
        if grad_den <= 0:
            수료율 = 0.0
        else:
            수료율 = (total_completed / grad_den * 100)

        # 취업률: 취업인원 / {수료인원 - (취업산정제외인원 + 근로자)}
        emp_den = total_completed - (total_emp_excl + total_workers)
        취업률 = (total_employed / emp_den * 100) if emp_den > 0 else 0.0

        만족도 = (satisfaction_sum / satisfaction_count) if satisfaction_count > 0 else 0.0

        return {
            '모집률': round(모집률, 2),
            '수료율': round(수료율, 2),
            '취업률': round(취업률, 2),
            '만족도': round(만족도, 2),
        }

    def safe_date(s: Any) -> date | None:
        if not s:
            return None
        # Accept 'YYYY-MM-DD' or 'YYYY.MM.DD' or 'YYYY/MM/DD'
        ss = str(s).strip()
        for fmt in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(ss, fmt).date()
            except Exception:
                pass
        return None

    # 취업률 윈도우: 2024-07-01 ~ 2025-06-30, 상태는 '종강' 강제, 수료인원 비어있으면 제외
    def ended_in_window_and_done(row: Dict[str, Any], end_col: str | None, status_col: str | None, completed_col: str | None) -> bool:
        if not status_col or str(row.get(status_col, '')).strip() != '종강':
            return False
        # 수료인원 값 존재 검사(빈 문자열/None 제외, 0은 허용)
        if completed_col is not None:
            cv = row.get(completed_col)
            if cv is None or (isinstance(cv, str) and cv.strip() == ''):
                return False
        dt = safe_date(row.get(end_col)) if end_col else None
        if not dt and end_col and '종강' in end_col:
            dt = safe_date(row.get('종강'))
        if not dt:
            return False
        return date(2024, 7, 1) <= dt <= date(2025, 6, 30)

    # --------------------
    # Routes
    # --------------------
    @app.route('/')
    def index():
        return render_template('index.html')

    # Filters
    @app.get('/api/filters/years')
    def get_years():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year_col = mapping['year'] or '년도'
            years: List[int] = []
            if year_col:
                cur = conn.execute(f"SELECT DISTINCT {year_col} as y FROM kdt_programs WHERE {year_col} IS NOT NULL ORDER BY y DESC")
                years = [parse_int(r['y']) for r in cur.fetchall() if r['y'] is not None]
            return jsonify(years)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/filters/quarters')
    def get_quarters():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            quarter_col = mapping['quarter'] or '분기'
            quarters: List[str] = []
            if quarter_col:
                cur = conn.execute(f"SELECT DISTINCT {quarter_col} as q FROM kdt_programs WHERE {quarter_col} IS NOT NULL")
                quarters = [str(r['q']) for r in cur.fetchall() if r['q'] is not None]
                if not quarters:
                    quarters = ['Q1', 'Q2', 'Q3', 'Q4']
            else:
                quarters = ['Q1', 'Q2', 'Q3', 'Q4']
            return jsonify(quarters)
        except Exception as e:
            print(e)
            return jsonify(['Q1', 'Q2', 'Q3', 'Q4'])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/filters/team')
    def get_team_filter():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            team_col = mapping['team']
            if not team_col:
                return jsonify([])
            cur = conn.execute(f"SELECT DISTINCT {team_col} as t FROM kdt_programs WHERE {team_col} IS NOT NULL")
            teams = [str(r['t']) for r in cur.fetchall() if r['t']]
            return jsonify(teams)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Programs CRUD
    def build_program_filters(args: Dict[str, Any], mapping: Dict[str, str]) -> Tuple[str, List[Any]]:
        clauses: List[str] = []
        params: List[Any] = []
        if args.get('year') and mapping['year']:
            clauses.append(f"{mapping['year']} = ?")
            params.append(args.get('year'))
        if args.get('quarter') and mapping['quarter']:
            clauses.append(f"{mapping['quarter']} = ?")
            params.append(args.get('quarter'))
        # category maps to team/과정구분
        if args.get('category') and mapping['team']:
            clauses.append(f"{mapping['team']} = ?")
            params.append(args.get('category'))
        if args.get('status') and mapping['status']:
            clauses.append(f"{mapping['status']} = ?")
            params.append(args.get('status'))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ''
        return where, params

    @app.get('/api/programs')
    def list_programs():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            where, params = build_program_filters(request.args, mapping)
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]
            return jsonify(rows)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def normalize_payload(payload: Dict[str, Any], conn: sqlite3.Connection) -> Dict[str, Any]:
        # Accept Korean keys and some English alternatives
        cols = get_table_columns(conn, 'kdt_programs')
        key_map = {
            '과정코드': ['과정코드', 'program_code', 'code'],
            'HRD_Net_과정명': ['HRD_Net_과정명', '과정명', 'name', 'program_name'],
            '회차': ['회차', 'round'],
            '기수': ['기수', '배치', 'batch'],
            '진행상태': ['진행상태', 'status'],
            '개강일': ['개강일', '개강', 'start_date'],
            '종강일': ['종강일', '종강', 'end_date'],
            '년도': ['년도', 'year'],
            '분기': ['분기', 'quarter'],
            '담당팀': ['담당팀', '팀', '과정구분', 'category', 'team'],
            '교육시간': ['교육시간', 'hours'],
            '정원': ['정원', 'capacity'],
            'HRD_확정': ['HRD_확정', 'confirmed'],
            '중도이탈': ['중도이탈', 'dropouts'],
            '수료인원': ['수료인원', 'completed'],
            '취업인원': ['취업인원', 'employed'],
            '근로자': ['근로자', 'workers'],
            '취업산정제외인원': ['취업산정제외인원', 'employment_excluded'],
            '수료산정 제외인원': ['수료산정 제외인원', '산정제외', 'excluded'],
            'HRD_만족도': ['HRD_만족도', 'satisfaction']
        }
        normalized: Dict[str, Any] = {}
        for target_key, aliases in key_map.items():
            for a in aliases:
                if a in payload and target_key in cols:
                    normalized[target_key] = payload[a]
                    break
        # Ensure any nullable missing keys exist as None
        for c in cols:
            if c not in normalized and c != 'id':
                normalized[c] = None
        return normalized

    def quote_ident(name: str) -> str:
        return '"' + str(name).replace('"', '""') + '"'

    def quote_ident(name: str) -> str:
        # SQLite identifier quoting for names with spaces/special chars
        return '"' + str(name).replace('"', '""') + '"'

    @app.post('/api/programs')
    def create_program():
        try:
            conn = get_db_connection()
            payload = request.get_json(force=True, silent=True) or {}
            data = normalize_payload(payload, conn)
            cols = [k for k in data.keys() if k != 'id']
            placeholders = ','.join(['?'] * len(cols))
            sql = f"INSERT INTO kdt_programs ({','.join([quote_ident(c) for c in cols])}) VALUES ({placeholders})"
            cur = conn.execute(sql, [data[c] for c in cols])
            conn.commit()
            return jsonify({"id": cur.lastrowid, "success": True, "message": "생성되었습니다."})
        except Exception as e:
            print(e)
            return jsonify({"id": None, "success": False, "message": str(e)})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.put('/api/programs/<int:pid>')
    def update_program(pid: int):
        try:
            conn = get_db_connection()
            payload = request.get_json(force=True, silent=True) or {}
            data = normalize_payload(payload, conn)
            if not data:
                return jsonify({"id": pid, "success": False, "message": "업데이트할 데이터가 없습니다."})
            sets = [f"{quote_ident(k)} = ?" for k in data.keys() if k != 'id']
            sql = f"UPDATE kdt_programs SET {', '.join(sets)} WHERE id = ?"
            params = [data[k] for k in data.keys() if k != 'id'] + [pid]
            conn.execute(sql, params)
            conn.commit()
            return jsonify({"id": pid, "success": True, "message": "수정되었습니다."})
        except Exception as e:
            print(e)
            return jsonify({"id": pid, "success": False, "message": str(e)})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.delete('/api/programs/<int:pid>')
    def delete_program(pid: int):
        try:
            conn = get_db_connection()
            conn.execute("DELETE FROM kdt_programs WHERE id = ?", (pid,))
            conn.commit()
            return jsonify({"id": pid, "success": True, "message": "삭제되었습니다."})
        except Exception as e:
            print(e)
            return jsonify({"id": pid, "success": False, "message": str(e)})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.post('/api/programs/reset')
    def reset_programs():
        try:
            conn = get_db_connection()
            conn.execute("DELETE FROM kdt_programs")
            conn.commit()
            return jsonify({"success": True, "message": "전체 삭제되었습니다."})
        except Exception as e:
            print(e)
            return jsonify({"success": False, "message": str(e)})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Dashboard
    @app.get('/api/dashboard/kpi')
    def dashboard_kpi():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            where, params = build_program_filters(request.args, mapping)
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]
            # 전체 KPI (초기값)
            kpi_all = calc_kpis(rows, mapping)
            # 종강 연도 2025 필터
            end_col = mapping.get('end')
            def end_year_is_2025(r: Dict[str, Any]) -> bool:
                dt = safe_date(r.get(end_col)) if end_col else None
                if not dt and end_col and '종강' in end_col:
                    dt = safe_date(r.get('종강'))
                return bool(dt and dt.year == 2025)

            rows_end2025 = [r for r in rows if end_year_is_2025(r)]
            kpi_2025 = calc_kpis(rows_end2025, mapping)
            status_col = mapping.get('status')
            done_rows_2025 = [r for r in rows_end2025 if status_col and str(r.get(status_col, '')).strip() == '종강']
            kpi_done_2025 = calc_kpis(done_rows_2025, mapping)

            kpi_all['모집률'] = kpi_2025['모집률']
            kpi_all['수료율'] = kpi_done_2025['수료율']
            kpi_all['만족도'] = kpi_done_2025['만족도']
            # 취업률: 2024-07-01 ~ 2025-06-30 사이에 종강했고 상태 '종강'인 행만 대상
            rows_window_done = [r for r in rows if ended_in_window_and_done(r, end_col, status_col, mapping.get('completed'))]
            kpi_window = calc_kpis(rows_window_done, mapping)
            kpi_all['취업률'] = kpi_window['취업률']
            return jsonify(kpi_all)
        except Exception as e:
            print(e)
            return jsonify({'모집률': 0, '수료율': 0, '취업률': 0, '만족도': 0})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/dashboard/trends')
    def dashboard_trends():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            # Aggregate by quarter of the given year, or across available if not provided
            year = request.args.get('year')
            quarter_col = mapping['quarter'] or '분기'
            year_col = mapping['year'] or '년도'
            where_clauses = []
            params: List[Any] = []
            if year and year_col:
                where_clauses.append(f"{year_col} = ?")
                params.append(year)
            where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ''
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]

            # group by quarter
            buckets: Dict[str, List[Dict[str, Any]]] = {}
            for r in rows:
                q = str(r.get(quarter_col) or '').strip() if quarter_col else ''
                if not q:
                    # derive quarter from start date if possible
                    s_col = mapping['start']
                    dt = safe_date(r.get(s_col)) if s_col else None
                    if dt:
                        month = dt.month
                        q = f"Q{((month - 1)//3) + 1}"
                if not q:
                    q = 'Q1'
                buckets.setdefault(q, []).append(r)

            result = []
            for q in ['Q1', 'Q2', 'Q3', 'Q4']:
                brs = buckets.get(q, [])
                end_col = mapping.get('end')
                def end_year_is_2025(r: Dict[str, Any]) -> bool:
                    dt = safe_date(r.get(end_col)) if end_col else None
                    if not dt and end_col and '종강' in end_col:
                        dt = safe_date(r.get('종강'))
                    return bool(dt and dt.year == 2025)

                brs_end2025 = [r for r in brs if end_year_is_2025(r)]
                # 모집률: 2025 종강 연도 대상
                kpi_2025 = calc_kpis(brs_end2025, mapping)
                # 수료율/만족도: 2025 종강 연도 + 상태 종강 대상
                status_col = mapping.get('status')
                brs_done_2025 = [r for r in brs_end2025 if status_col and str(r.get(status_col, '')).strip() == '종강']
                kpi_done_2025 = calc_kpis(brs_done_2025, mapping)
                # 취업률: 윈도우(2024-07-01~2025-06-30) + 상태 종강 대상
                brs_window_done = [r for r in brs if ended_in_window_and_done(r, end_col, status_col, mapping.get('completed'))]
                kpi_window = calc_kpis(brs_window_done, mapping)
                # 만족도는 0~5 → 100점 환산 (종강+2025 기준)
                kpi_100 = {
                    'quarter': q,
                    '모집률': kpi_2025['모집률'],
                    '수료율': kpi_done_2025['수료율'],
                    '취업률': kpi_window['취업률'],
                    '만족도': round((kpi_done_2025['만족도'] or 0) / 5 * 100, 2)
                }
                result.append(kpi_100)
            return jsonify(result)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Education
    @app.get('/api/education/stats')
    def education_stats():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            cur = conn.execute("SELECT * FROM kdt_programs")
            rows = [dict(r) for r in cur.fetchall()]
            kpi = calc_kpis(rows, mapping)
            total_courses = len(rows)
            total_students = sum(parse_int(r.get(mapping['confirmed'])) for r in rows) if mapping['confirmed'] else 0
            return jsonify({
                '전체과정수': total_courses,
                '총수강생': total_students,
                '평균수료율': kpi['수료율'],
                '평균취업률': kpi['취업률']
            })
        except Exception as e:
            print(e)
            return jsonify({'전체과정수': 0, '총수강생': 0, '평균수료율': 0, '평균취업률': 0})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # New: education counts by year (default 2025)
    @app.get('/api/education/counts')
    def education_counts():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year = request.args.get('year') or '2025'
            year_col = mapping.get('year') or '년도'
            confirmed_col = mapping.get('confirmed')
            params: List[Any] = []
            where = ''
            if year_col and year:
                where = f"WHERE {year_col} = ?"
                params.append(year)
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]
            total_courses = len(rows)
            total_students = 0
            if confirmed_col:
                for r in rows:
                    total_students += parse_int(r.get(confirmed_col))
            return jsonify({'전체과정수': total_courses, '총수강생': total_students, 'year': year})
        except Exception as e:
            print(e)
            return jsonify({'전체과정수': 0, '총수강생': 0, 'year': None})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/education/timeline/<int:year>')
    def education_timeline(year: int):
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            start_col = mapping['start']
            end_col = mapping['end']
            year_col = mapping['year'] or '년도'
            cur = conn.execute(f"SELECT * FROM kdt_programs WHERE {year_col} = ?", (year,))
            rows = [dict(r) for r in cur.fetchall()]
            # Python-side sort by start date with fallback
            def start_key(r: Dict[str, Any]):
                dt = safe_date(r.get(start_col)) if start_col else None
                if not dt and '개강' in (start_col or ''):
                    dt = safe_date(r.get('개강'))
                return dt or date(year, 1, 1)

            rows.sort(key=start_key)
            events = []
            for r in rows:
                sdt = safe_date(r.get(start_col)) if start_col else None
                if not sdt:
                    sdt = safe_date(r.get('개강'))
                edt = safe_date(r.get(end_col)) if end_col else None
                if not edt:
                    edt = safe_date(r.get('종강'))
                events.append({
                    'id': r.get('id'),
                    'name': r.get(mapping['name']),
                    'team': r.get(mapping['team']),
                    'status': r.get(mapping['status']),
                    'category': r.get('과정구분') or r.get(mapping['team']),
                    'start': sdt.isoformat() if sdt else None,
                    'end': edt.isoformat() if edt else None,
                })
            return jsonify(events)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Business
    @app.get('/api/business/kpi')
    def business_kpi():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            # Example KPI: total courses, total confirmed (students). Placeholder for revenue, progress.
            cur = conn.execute("SELECT * FROM kdt_programs")
            rows = [dict(r) for r in cur.fetchall()]
            total_courses = len(rows)
            total_students = sum(parse_int(r.get(mapping['confirmed'])) for r in rows) if mapping['confirmed'] else 0
            # 가상의 집행률/진행률/목표 달성률은 데이터 부재 시 0 처리
            return jsonify({
                '총과정수': total_courses,
                '총학생수': total_students,
                '예산집행률': 0,
                '진행률': 0,
                '목표달성률': 0,
                '총매출': 0,
                '참여인원': total_students
            })
        except Exception as e:
            print(e)
            return jsonify({'총과정수': 0, '총학생수': 0, '예산집행률': 0, '진행률': 0, '목표달성률': 0, '총매출': 0, '참여인원': 0})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/business/revenue-trend')
    def business_revenue_trend():
        try:
            # Placeholder revenue trend from program counts per month; in real case, join to revenue table
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            start_col = mapping['start']
            cur = conn.execute("SELECT * FROM kdt_programs")
            rows = [dict(r) for r in cur.fetchall()]
            today = date.today()
            labels: List[str] = []
            current: List[int] = []
            previous: List[int] = []
            goal: List[int] = []
            # build last 12 months
            for i in range(11, -1, -1):
                y = today.year if today.month - i > 0 else today.year - 1
                m = ((today.month - i - 1) % 12) + 1
                labels.append(f"{y}-{m:02d}")
                # revenue proxy: number of courses starting in this month * fixed amount
                cur_month = 0
                prev_month = 0
                for r in rows:
                    sdt = safe_date(r.get(start_col)) if start_col else None
                    if sdt and sdt.year == y and sdt.month == m:
                        cur_month += 1
                    if sdt and sdt.year == y - 1 and sdt.month == m:
                        prev_month += 1
                current.append(cur_month * 100)
                previous.append(prev_month * 100)
                goal.append(150)
            return jsonify({
                'labels': labels,
                'current': current,
                'previous': previous,
                'goal': goal
            })
        except Exception as e:
            print(e)
            return jsonify({'labels': [], 'current': [], 'previous': [], 'goal': []})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # New: Business revenue metrics per program+round with yearly filter (year=all supported)
    @app.get('/api/business/revenue-metrics')
    def business_revenue_metrics():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year = request.args.get('year') or '2025'
            year_col = mapping.get('year') or '년도'
            start_col = mapping.get('start')
            name_col = mapping.get('name')
            round_col = mapping.get('batch') or '회차'
            quarter_col = mapping.get('quarter') or '분기'
            confirmed_col = mapping.get('confirmed')
            completed_col = mapping.get('completed')
            complete_excl_col = mapping.get('complete_excluded')
            hours_col = '교육시간'

            # Build where
            where = ''
            params: List[Any] = []
            if (year and year.lower() != 'all') and year_col:
                where = f"WHERE {year_col} = ?"
                params.append(year)

            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]

            # Group by program+round
            groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
            for r in rows:
                program = str(r.get(name_col) or r.get('과정명') or '').strip()
                rnd = str(r.get(round_col) or '').strip()
                key = (program, rnd)
                groups.setdefault(key, []).append(r)

            UNIT = 18150
            def to_int(v: Any) -> int:
                return parse_int(v, 0)

            items = []
            for (program, rnd), grs in groups.items():
                # Aggregate inputs over group (confirmed, completed, complete_excluded, hours)
                confirmed_sum = sum(to_int(g.get(confirmed_col)) for g in grs) if confirmed_col else 0
                completed_sum = sum(to_int(g.get(completed_col)) for g in grs) if completed_col else 0
                excl_sum = sum(to_int(g.get(complete_excl_col)) for g in grs) if complete_excl_col else 0
                hours_sum = sum(to_int(g.get(hours_col)) for g in grs)

                # r: graduation rate based on current rule
                denom = confirmed_sum - excl_sum
                r = (completed_sum / denom) if denom > 0 else 0

                expected = int(round(r * confirmed_sum * hours_sum * UNIT))
                actual = int(round(completed_sum * hours_sum * UNIT))
                maxrev = int(round(confirmed_sum * hours_sum * UNIT))
                gap = expected - actual

                # pick latest start date for sorting
                best_dt: date | None = None
                if start_col:
                    for g in grs:
                        dt = safe_date(g.get(start_col))
                        if not dt and '개강' in (start_col or ''):
                            dt = safe_date(g.get('개강'))
                        if dt and (best_dt is None or dt > best_dt):
                            best_dt = dt

                items.append({
                    'program': program,
                    'round': rnd,
                    'quarter': grs[0].get(quarter_col) if grs else None,
                    'expected': expected,
                    'actual': actual,
                    'gap': gap,
                    'max': maxrev,
                    'start': best_dt.isoformat() if best_dt else None
                })

            # Sort by start desc (None last)
            def sort_key(it):
                s = it.get('start')
                return (s is None, s)
            items.sort(key=sort_key, reverse=True)

            totals = {
                'expected': int(sum(it['expected'] for it in items)),
                'actual': int(sum(it['actual'] for it in items)),
                'gap': int(sum(it['gap'] for it in items)),
                'max': int(sum(it['max'] for it in items)),
            }
            return jsonify({'year': (None if (year and year.lower()=='all') else year), 'totals': totals, 'items': items})
        except Exception as e:
            print(e)
            return jsonify({'year': None, 'totals': {'expected':0,'actual':0,'gap':0,'max':0}, 'items': []})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/business/monthly-revenue')
    def business_monthly_revenue():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year = request.args.get('year') or '2025'
            program_like = request.args.get('program_like')

            # Load base programs with optional year filter
            where = ''
            params: List[Any] = []
            year_col = mapping.get('year') or '년도'
            if (year and year.lower() != 'all') and year_col:
                where = f"WHERE {year_col} = ?"
                params.append(year)
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            programs = [dict(r) for r in cur.fetchall()]

            name_col = mapping.get('name')
            round_col = mapping.get('batch') or '회차'
            start_col = mapping.get('start')

            # Optional substring filter by program name
            if program_like and name_col:
                needle = str(program_like).strip()
                programs = [p for p in programs if needle in str(p.get(name_col, ''))]

            # Load monthly tables as maps by id (fail-safe if tables missing)
            hours_map: Dict[int, Dict[str, Any]] = {}
            enroll_map: Dict[int, Dict[str, Any]] = {}
            try:
                cur = conn.execute("SELECT * FROM kdt_monthly_hours")
                for r in cur.fetchall():
                    d = dict(r)
                    hours_map[int(d.get('id'))] = d
            except Exception:
                pass
            try:
                cur = conn.execute("SELECT * FROM kdt_monthly_enrollments")
                for r in cur.fetchall():
                    d = dict(r)
                    enroll_map[int(d.get('id'))] = d
            except Exception:
                pass

            months = [f"{m}M" for m in range(1, 13)]
            UNIT = 18150

            def to_int(v: Any) -> int:
                return parse_int(v, 0)

            items = []
            month_totals = {m: 0 for m in months}
            grand_total = 0

            for p in programs:
                pid = to_int(p.get('id'))
                h = hours_map.get(pid, {})
                e = enroll_map.get(pid, {})
                row = {
                    'program': p.get(name_col) or p.get('과정명'),
                    'round': p.get(round_col)
                }
                total = 0
                for m in months:
                    v = to_int(h.get(m)) * to_int(e.get(m)) * UNIT
                    row[m] = v
                    month_totals[m] += v
                    total += v
                row['total'] = total
                grand_total += total

                # attach start date string for sorting (desc)
                sdt = None
                if start_col:
                    sdt = safe_date(p.get(start_col))
                    if not sdt and '개강' in (start_col or ''):
                        sdt = safe_date(p.get('개강'))
                row['_start'] = sdt.isoformat() if sdt else ''
                items.append(row)

            # Sort by start desc (empty last)
            def sort_key(it):
                s = it.get('_start') or ''
                return (s == '', s)
            items.sort(key=sort_key, reverse=True)
            for it in items:
                it.pop('_start', None)

            totals = {'total': grand_total}
            totals.update(month_totals)
            return jsonify({'year': (None if (year and year.lower()=='all') else year), 'months': months, 'totals': totals, 'items': items})
        except Exception as e:
            print(e)
            return jsonify({'year': None, 'months': [], 'totals': {}, 'items': []})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @app.get('/api/business/monthly-expected')
    def business_monthly_expected():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year = int(request.args.get('year') or 2025)
            month = int(request.args.get('month') or 7)
            program_like = request.args.get('program_like')

            name_col = mapping.get('name')
            round_col = mapping.get('batch') or '회차'
            start_col = mapping.get('start')
            end_col = mapping.get('end')

            # load programs for (year) - use overlap with the target month window based on start/end
            cur = conn.execute("SELECT * FROM kdt_programs")
            programs = [dict(r) for r in cur.fetchall()]
            if program_like and name_col:
                needle = str(program_like).strip()
                programs = [p for p in programs if needle in str(p.get(name_col, ''))]

            # hours/enroll maps by id
            hours_map: Dict[int, Dict[str, Any]] = {}
            enroll_map: Dict[int, Dict[str, Any]] = {}
            try:
                cur = conn.execute("SELECT * FROM kdt_monthly_hours")
                for r in cur.fetchall():
                    d = dict(r)
                    hours_map[int(d.get('id'))] = d
            except Exception:
                pass
            try:
                cur = conn.execute("SELECT * FROM kdt_monthly_enrollments")
                for r in cur.fetchall():
                    d = dict(r)
                    enroll_map[int(d.get('id'))] = d
            except Exception:
                pass

            # helpers
            def month_start(y: int, m: int) -> date:
                return date(y, m, 1)

            def month_end(y: int, m: int) -> date:
                if m == 12:
                    return date(y, 12, 31)
                return date(y, m+1, 1) - timedelta(days=1)

            from datetime import timedelta
            window_start = month_start(year, month)
            window_end = month_end(year, month)

            def months_since_start(s: date, target: date) -> int:
                # count start month as 1M
                return (target.year - s.year) * 12 + (target.month - s.month) + 1

            UNIT = 18150
            items = []
            total = 0

            for p in programs:
                pid = parse_int(p.get('id'))
                sdt = safe_date(p.get(start_col)) if start_col else None
                if not sdt and start_col and '개강' in start_col:
                    sdt = safe_date(p.get('개강'))
                edt = safe_date(p.get(end_col)) if end_col else None
                if not edt and end_col and '종강' in end_col:
                    edt = safe_date(p.get('종강'))
                if not sdt:
                    continue
                # overlap check: course active in the target month
                if sdt > window_end:
                    continue
                if edt and edt < window_start:
                    continue

                m_index = months_since_start(sdt, window_start)
                if m_index < 1 or m_index > 12:
                    continue
                col = f"{m_index}M"
                h = hours_map.get(pid, {}).get(col)
                e = enroll_map.get(pid, {}).get(col)
                expected = parse_int(h) * parse_int(e) * UNIT
                total += expected
                items.append({
                    'program': p.get(name_col) or p.get('과정명'),
                    'round': p.get(round_col),
                    'monthIndex': m_index,
                    'expected': expected
                })

            # sort by expected desc
            items.sort(key=lambda x: x['expected'], reverse=True)
            return jsonify({'year': year, 'month': month, 'total': total, 'items': items})
        except Exception as e:
            print(e)
            return jsonify({'year': None, 'month': None, 'total': 0, 'items': []})
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # --------------------
    # Analytics: metrics by year/quarter/month/program
    # --------------------
    @app.get('/api/analytics/metrics')
    def analytics_metrics():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)

            # Base filtering from query (year/quarter/category/status)
            where, params = build_program_filters(request.args, mapping)
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            rows = [dict(r) for r in cur.fetchall()]

            # Optional program_like substring filter
            program_like = request.args.get('program_like')
            if program_like:
                name_col = mapping.get('name')
                if name_col:
                    needle = str(program_like).strip()
                    rows = [r for r in rows if needle in str(r.get(name_col, ''))]

            granularity = (request.args.get('granularity') or 'quarter').lower()
            ruleset = (request.args.get('ruleset') or 'dashboard').lower()

            quarter_col = mapping.get('quarter') or '분기'
            end_col = mapping.get('end')
            name_col = mapping.get('name')
            status_col = mapping.get('status')

            def get_bucket_key(r: Dict[str, any]) -> str:
                if granularity == 'year':
                    # year by end date when available else by year column
                    dt = safe_date(r.get(end_col)) if end_col else None
                    if not dt and end_col and '종강' in end_col:
                        dt = safe_date(r.get('종강'))
                    if dt:
                        return str(dt.year)
                    ycol = mapping.get('year') or '년도'
                    return str(r.get(ycol) or '')
                if granularity == 'quarter':
                    q = str(r.get(quarter_col) or '').strip() if quarter_col else ''
                    if q:
                        return q
                    # fallback via end date
                    dt = safe_date(r.get(end_col)) if end_col else None
                    if not dt and end_col and '종강' in end_col:
                        dt = safe_date(r.get('종강'))
                    if dt:
                        return f"Q{((dt.month - 1)//3) + 1}"
                    return ''
                if granularity == 'month':
                    dt = safe_date(r.get(end_col)) if end_col else None
                    if not dt and end_col and '종강' in end_col:
                        dt = safe_date(r.get('종강'))
                    return f"{dt.year}-{dt.month:02d}" if dt else ''
                if granularity == 'program':
                    return str(r.get(name_col) or '')
                return ''

            # Bucket rows
            buckets: Dict[str, List[Dict[str, any]]] = {}
            for r in rows:
                key = get_bucket_key(r)
                if not key:
                    continue
                buckets.setdefault(key, []).append(r)

            def compute_dashboard_set(brs: List[Dict[str, Any]]):
                # 모집률: 2025 종강 연도 대상
                def end_year_is_2025(x: Dict[str, Any]) -> bool:
                    dt = safe_date(x.get(end_col)) if end_col else None
                    if not dt and end_col and '종강' in end_col:
                        dt = safe_date(x.get('종강'))
                    return bool(dt and dt.year == 2025)

                rows_end2025 = [x for x in brs if end_year_is_2025(x)]
                kpi_recruit = calc_kpis(rows_end2025, mapping)

                # 수료율/만족도: 2025 종강 연도 + 상태 종강
                rows_done_2025 = [x for x in rows_end2025 if status_col and str(x.get(status_col, '')).strip() == '종강']
                kpi_done_2025 = calc_kpis(rows_done_2025, mapping)

                # 취업률: 2024-07-01~2025-06-30 & 상태 종강 & 수료인원 존재
                rows_window_done = [x for x in brs if ended_in_window_and_done(x, end_col, status_col, mapping.get('completed'))]
                kpi_window = calc_kpis(rows_window_done, mapping)

                return {
                    '모집률': kpi_recruit['모집률'],
                    '수료율': kpi_done_2025['수료율'],
                    '취업률': kpi_window['취업률'],
                    '만족도': kpi_done_2025['만족도']
                }

            def compute_raw_set(brs: List[Dict[str, Any]]):
                k = calc_kpis(brs, mapping)
                return {'모집률': k['모집률'], '수료율': k['수료율'], '취업률': k['취업률'], '만족도': k['만족도']}

            result = []
            for key in (['Q1','Q2','Q3','Q4'] if granularity=='quarter' else sorted(buckets.keys())):
                brs = buckets.get(key, [])
                if not brs:
                    # keep empty buckets for quarter to show zeroes
                    if granularity == 'quarter':
                        result.append({'key': key, '모집률': 0, '수료율': 0, '취업률': 0, '만족도': 0})
                    continue
                metrics = compute_dashboard_set(brs) if ruleset=='dashboard' else compute_raw_set(brs)
                # 트렌드 그래프가 만족도 100점 환산을 원할 수 있어도 원본(0~5) 유지; 프론트에서 환산
                result.append({'key': key, **metrics})

            return jsonify(result)
        except Exception as e:
            print(e)
            return jsonify([])
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # New: Monthly revenue with arithmetic progression for enrollment decline
    @app.get('/api/business/monthly-revenue-progression')
    def business_monthly_revenue_progression():
        try:
            conn = get_db_connection()
            mapping = get_schema_mapping(conn)
            year = request.args.get('year') or '2025'
            program_like = request.args.get('program_like', '').strip()
            
            year_col = mapping.get('year') or '년도'
            name_col = mapping.get('name')
            round_col = mapping.get('batch') or '회차'
            start_col = mapping.get('start')
            end_col = mapping.get('end')
            confirmed_col = mapping.get('confirmed')
            completed_col = mapping.get('completed')
            hours_col = '교육시간'
            
            # Build where clause
            where = ''
            params: List[Any] = []
            if year and year.lower() != 'all' and year_col:
                where = f"WHERE {year_col} = ?"
                params.append(year)
            
            cur = conn.execute(f"SELECT * FROM kdt_programs {where}", params)
            programs = [dict(r) for r in cur.fetchall()]
            
            # Filter by program name if specified
            if program_like and name_col:
                programs = [p for p in programs if program_like in str(p.get(name_col, ''))]
            
            UNIT = 18150
            result_items = []
            total_monthly_revenue = {}
            
            for program in programs:
                program_name = str(program.get(name_col) or program.get('과정명') or '').strip()
                round_num = str(program.get(round_col) or '').strip()
                start_date = safe_date(program.get(start_col))
                end_date = safe_date(program.get(end_col))
                confirmed = parse_int(program.get(confirmed_col)) if confirmed_col else 0
                completed = parse_int(program.get(completed_col)) if completed_col else 0
                hours = parse_int(program.get(hours_col))
                
                if not start_date or not end_date or confirmed <= 0 or hours <= 0:
                    continue
                
                # Calculate duration in months
                duration_months = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month) + 1
                if duration_months <= 0:
                    duration_months = 1
                
                # Calculate arithmetic progression
                # a = (confirmed - completed) / duration_months
                decline_per_month = (confirmed - completed) / duration_months
                
                monthly_data = []
                current_date = start_date.replace(day=1)  # Start from first day of start month
                
                for month_idx in range(duration_months):
                    # Calculate enrollment for this month using arithmetic sequence
                    enrollment_this_month = confirmed - (month_idx * decline_per_month)
                    
                    # Ensure enrollment doesn't go below completed count
                    if month_idx == duration_months - 1:
                        enrollment_this_month = completed
                    elif enrollment_this_month < completed:
                        enrollment_this_month = completed
                    
                    # Calculate monthly revenue
                    monthly_hours = hours / duration_months  # Distribute hours evenly
                    monthly_revenue = int(round(enrollment_this_month * monthly_hours * UNIT))
                    
                    month_key = current_date.strftime('%Y-%m')
                    monthly_data.append({
                        'month': month_key,
                        'enrollment': round(enrollment_this_month, 1),
                        'hours': round(monthly_hours, 1),
                        'revenue': monthly_revenue
                    })
                    
                    # Add to total
                    if month_key not in total_monthly_revenue:
                        total_monthly_revenue[month_key] = 0
                    total_monthly_revenue[month_key] += monthly_revenue
                    
                    # Move to next month
                    if current_date.month == 12:
                        current_date = current_date.replace(year=current_date.year + 1, month=1)
                    else:
                        current_date = current_date.replace(month=current_date.month + 1)
                
                result_items.append({
                    'program': program_name,
                    'round': round_num,
                    'confirmed': confirmed,
                    'completed': completed,
                    'duration_months': duration_months,
                    'decline_per_month': round(decline_per_month, 2),
                    'monthly_data': monthly_data,
                    'total_revenue': sum(item['revenue'] for item in monthly_data)
                })
            
            # Convert total_monthly_revenue to sorted list
            monthly_totals = [
                {'month': month, 'total_revenue': revenue}
                for month, revenue in sorted(total_monthly_revenue.items())
            ]
            
            return jsonify({
                'year': year if year != 'all' else None,
                'program_filter': program_like or None,
                'monthly_totals': monthly_totals,
                'programs': result_items,
                'grand_total': sum(total_monthly_revenue.values())
            })
            
        except Exception as e:
            print(f"Error in monthly revenue progression: {e}")
            return jsonify({'error': str(e)}), 500
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)


