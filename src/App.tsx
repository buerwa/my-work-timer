import React, { useState, useEffect, useMemo, useCallback } from "react";

// --- 类型定义 ---

// 设置
type AppSettings = {
  // 正常工作日休息时间
  normalLunchStart: string; // "12:00"
  normalLunchEnd: string; // "13:30"
  normalDinnerStart: string; // "17:30"
  normalDinnerEnd: string; // "18:00"

  // 节假日/加班休息时间
  overtimeLunchStart: string; // "12:00"
  overtimeLunchEnd: string; // "13:30"

  // 在岗要求
  requiredStart: string; // "09:00"
  requiredEnd: string; // "17:30"

  // 日均工时要求
  requiredDailyHours: number; // 8
};

// 打卡记录
type WorkRecord = {
  id: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  dayType: "normal" | "overtime"; // normal: 工作日/调休, overtime: 节假日/周末加班
};

// --- 帮助函数 ---

/**
 * 将 "HH:mm" 格式的时间字符串转换为当天从0点开始的分钟数
 */
const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * 计算两个时间范围的重叠分钟数
 * @param start1 范围1开始 (分钟)
 * @param end1 范围1结束 (分钟)
 * @param start2 范围2开始 (分钟)
 * @param end2 范围2结束 (分钟)
 * @returns 重叠的分钟数
 */

const calculateOverlapCorrected = (
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number => {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);

  if (overlapStart < overlapEnd) {
    return overlapEnd - overlapStart;
  }
  return 0;
};

/**
 * 格式化分钟数为 "HH:mm"
 */
const minutesToHHMM = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60); // 四舍五入避免精度问题
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}`;
};

/**
 * 格式化小时数为 N.xx 小时
 */
const formatHours = (hours: number): string => {
  return hours.toFixed(2);
};

/**
 * 自定义 Hook，用于将状态同步到 localStorage
 */
function useStickyState<T>(
  defaultValue: T,
  key: string
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stickyValue = window.localStorage.getItem(key);
      return stickyValue !== null
        ? (JSON.parse(stickyValue) as T)
        : defaultValue;
    } catch (error) {
      console.warn(`Error parsing localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, value]);

  return [value, setValue];
}

// --- 默认设置 ---
const DEFAULT_SETTINGS: AppSettings = {
  normalLunchStart: "12:00",
  normalLunchEnd: "13:30",
  normalDinnerStart: "17:30",
  normalDinnerEnd: "18:00",
  overtimeLunchStart: "12:00",
  overtimeLunchEnd: "13:30",
  requiredStart: "09:00",
  requiredEnd: "17:30",
  requiredDailyHours: 8,
};

// --- 主应用组件 ---
function App() {
  // --- 状态 ---
  const [records, setRecords] = useStickyState<WorkRecord[]>(
    [],
    "workTimer:records"
  );
  const [settings, setSettings] = useStickyState<AppSettings>(
    DEFAULT_SETTINGS,
    "workTimer:settings"
  );
  const [now, setNow] = useState(new Date());
  const [is12Hour, setIs12Hour] = useStickyState(false, "workTimer:is12Hour");

  // 表单输入状态
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:30");
  const [dayType, setDayType] = useState<"normal" | "overtime">("normal");

  // --- 效果 ---

  // 实时时钟
  useEffect(() => {
    const timerId = setInterval(() => {
      setNow(new Date());
    }, 1000); // 每秒更新
    return () => clearInterval(timerId);
  }, []);

  // --- 核心计算逻辑 ---

  /**
   * 计算单条记录的有效工时（小时）
   */
  const calculateWorkHours = useCallback(
    (record: WorkRecord, appSettings: AppSettings): number => {
      const startMins = timeToMinutes(record.startTime);
      const endMins = timeToMinutes(record.endTime);

      // 晚于下班时间或时间无效
      if (endMins <= startMins) {
        return 0;
      }

      const totalDurationMins = endMins - startMins;
      let breakMins = 0;

      if (record.dayType === "normal") {
        // 正常工作日：计算午休和晚休重叠
        breakMins += calculateOverlap(
          // <--- 已修改
          startMins,
          endMins,
          timeToMinutes(appSettings.normalLunchStart),
          timeToMinutes(appSettings.normalLunchEnd)
        );
        breakMins += calculateOverlap(
          // <--- 已修改
          startMins,
          endMins,
          timeToMinutes(appSettings.normalDinnerStart),
          timeToMinutes(appSettings.normalDinnerEnd)
        );
      } else {
        // 加班/节假日：只计算午休重叠
        breakMins += calculateOverlap(
          // <--- 已修改
          startMins,
          endMins,
          timeToMinutes(appSettings.overtimeLunchStart),
          timeToMinutes(appSettings.overtimeLunchEnd)
        );
      }

      const netWorkMins = totalDurationMins - breakMins;
      let netWorkHours = netWorkMins / 60;

      // 节假日/加班，最多记录 8 小时
      if (record.dayType === "overtime") {
        netWorkHours = Math.min(netWorkHours, 8);
      }

      return netWorkHours;
    },
    []
  );

  // --- 仪表盘数据 (使用 useMemo 优化) ---
  const dashboardStats = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const monthRecords = records.filter((r) => r.date.startsWith(currentMonth));

    const normalWorkDays = monthRecords.filter((r) => r.dayType === "normal");
    const overtimeDays = monthRecords.filter((r) => r.dayType === "overtime");

    const totalWorkedDays = normalWorkDays.length;

    const totalNormalHours = normalWorkDays.reduce(
      (sum, r) => sum + calculateWorkHours(r, settings),
      0
    );

    const avgDailyHours =
      totalWorkedDays > 0 ? totalNormalHours / totalWorkedDays : 0;

    const requiredTotalHours = totalWorkedDays * settings.requiredDailyHours;
    const deficitHours = Math.max(0, requiredTotalHours - totalNormalHours);

    // 总加班工时 = 节假日/周末加班的全部工时
    const totalOvertimeHours = overtimeDays.reduce(
      (sum, r) => sum + calculateWorkHours(r, settings),
      0
    );

    // 额外统计周末加班工时
    const weekendOvertimeHours = overtimeDays.reduce((sum, r) => {
      const dayOfWeek = new Date(r.date).getDay(); // 0 = 周日, 6 = 周六
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return sum + calculateWorkHours(r, settings);
      }
      return sum;
    }, 0);

    return {
      totalWorkedDays,
      avgDailyHours,
      totalOvertimeHours,
      weekendOvertimeHours,
      deficitHours,
    };
  }, [records, settings, calculateWorkHours]);

  // --- 实时状态计算 ---
  const realTimeStatus = useMemo(() => {
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const requiredStartMins = timeToMinutes(settings.requiredStart);
    const requiredEndMins = timeToMinutes(settings.requiredEnd);

    const formatOptions: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: is12Hour,
    };
    const currentTime = now.toLocaleTimeString("en-US", formatOptions);

    let countdownMessage = "已过下班时间";

    if (nowMins < requiredStartMins) {
      const diffMins = requiredStartMins - nowMins;
      countdownMessage = `距离上班还有 ${minutesToHHMM(diffMins)}`;
    } else if (nowMins < requiredEndMins) {
      const diffMins = requiredEndMins - nowMins;
      countdownMessage = `距离下班还有 ${minutesToHHMM(diffMins)}`;
    }

    return {
      currentTime,
      countdownMessage,
    };
  }, [now, settings.requiredStart, settings.requiredEnd, is12Hour]);

  // --- 事件处理 ---

  const handleAddRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !startTime || !endTime) {
      alert("请填写完整日期和时间");
      return;
    }

    // 检查是否已有当天记录，如有则更新，否则新增
    const existingRecordIndex = records.findIndex((r) => r.date === date);
    const newRecord: WorkRecord = {
      id:
        existingRecordIndex > -1
          ? records[existingRecordIndex].id
          : crypto.randomUUID(),
      date,
      startTime,
      endTime,
      dayType,
    };

    let updatedRecords: WorkRecord[];
    if (existingRecordIndex > -1) {
      updatedRecords = records.map((r, i) =>
        i === existingRecordIndex ? newRecord : r
      );
    } else {
      updatedRecords = [...records, newRecord];
    }

    // 按日期排序
    updatedRecords.sort((a, b) => a.date.localeCompare(b.date));
    setRecords(updatedRecords);
  };

  const handleDeleteRecord = (id: string) => {
    if (window.confirm("确定删除这条记录吗？")) {
      setRecords(records.filter((r) => r.id !== id));
    }
  };

  const handleSettingsChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  // --- 渲染 ---
  return (
    <>
      <h1>工时统计器</h1>
      <div className="app-container">
        {/* 左侧：输入和看板 */}
        <div className="left-column">
          <div className="card">
            <h3>实时状态</h3>
            <div className="time-display">{realTimeStatus.currentTime}</div>
            <div className="countdown">{realTimeStatus.countdownMessage}</div>
            <button
              onClick={() => setIs12Hour(!is12Hour)}
              style={{ marginTop: "1rem" }}
            >
              切换 {is12Hour ? "24" : "12"} 小时制
            </button>
          </div>

          <div className="card" style={{ marginTop: "2rem" }}>
            <h3>本月仪表盘</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <h4>本月工作日</h4>
                <p>{dashboardStats.totalWorkedDays} 天</p>
              </div>
              <div className="stat-item">
                <h4>日平均工时</h4>
                <p>{formatHours(dashboardStats.avgDailyHours)} H</p>
              </div>
              <div className="stat-item">
                <h4>是否亏欠工时</h4>
                <p
                  style={{
                    color:
                      dashboardStats.deficitHours > 0 ? "#ff6b6b" : "#69db7c",
                  }}
                >
                  {dashboardStats.deficitHours > 0
                    ? `亏 ${formatHours(dashboardStats.deficitHours)} H`
                    : "达标"}
                </p>
              </div>
              <div className="stat-item">
                <h4>总加班 (节假日/周末)</h4>
                <p>{formatHours(dashboardStats.totalOvertimeHours)} H</p>
              </div>
              <div className="stat-item">
                <h4>其中周末加班</h4>
                <p>{formatHours(dashboardStats.weekendOvertimeHours)} H</p>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: "2rem" }}>
            <h3>⚙️ 调整设置</h3>
            <div className="form-group">
              <label>在岗要求</label>
              <input
                type="time"
                name="requiredStart"
                value={settings.requiredStart}
                onChange={handleSettingsChange}
              />
              <span> 到 </span>
              <input
                type="time"
                name="requiredEnd"
                value={settings.requiredEnd}
                onChange={handleSettingsChange}
              />
            </div>
            <div className="form-group">
              <label>日均工时要求</label>
              <input
                type="number"
                name="requiredDailyHours"
                value={settings.requiredDailyHours}
                onChange={handleSettingsChange}
                style={{ width: "50px" }}
              />{" "}
              H
            </div>
            <div className="form-group">
              <label>工作日午休</label>
              <input
                type="time"
                name="normalLunchStart"
                value={settings.normalLunchStart}
                onChange={handleSettingsChange}
              />
              <span> 到 </span>
              <input
                type="time"
                name="normalLunchEnd"
                value={settings.normalLunchEnd}
                onChange={handleSettingsChange}
              />
            </div>
            <div className="form-group">
              <label>工作日晚休</label>
              <input
                type="time"
                name="normalDinnerStart"
                value={settings.normalDinnerStart}
                onChange={handleSettingsChange}
              />
              <span> 到 </span>
              <input
                type="time"
                name="normalDinnerEnd"
                value={settings.normalDinnerEnd}
                onChange={handleSettingsChange}
              />
            </div>
            <div className="form-group">
              <label>加班/节假日午休</label>
              <input
                type="time"
                name="overtimeLunchStart"
                value={settings.overtimeLunchStart}
                onChange={handleSettingsChange}
              />
              <span> 到 </span>
              <input
                type="time"
                name="overtimeLunchEnd"
                value={settings.overtimeLunchEnd}
                onChange={handleSettingsChange}
              />
            </div>
            <p style={{ fontSize: "0.8rem", color: "#888" }}>
              设置已自动保存到浏览器
            </p>
          </div>
        </div>

        {/* 右侧：记录 */}
        <div className="right-column">
          <div className="card">
            <h3>添加/修改打卡记录</h3>
            <form onSubmit={handleAddRecord}>
              <div className="form-group">
                <label htmlFor="date">日期</label>
                <input
                  type="date"
                  id="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="startTime">上班时间</label>
                <input
                  type="time"
                  id="startTime"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="endTime">下班时间</label>
                <input
                  type="time"
                  id="endTime"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="dayType">日期类型</label>
                <select
                  id="dayType"
                  value={dayType}
                  onChange={(e) =>
                    setDayType(e.target.value as "normal" | "overtime")
                  }
                >
                  <option value="normal">工作日 (含调休)</option>
                  <option value="overtime">加班 (节假日/周末)</option>
                </select>
              </div>
              <button type="submit">保存记录</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: "2rem" }}>
            <h3>打卡日志 (本月)</h3>
            <div className="log-list">
              {records
                .filter((r) =>
                  r.date.startsWith(new Date().toISOString().slice(0, 7))
                )
                .sort((a, b) => b.date.localeCompare(a.date)) // 按日期倒序显示
                .map((r) => (
                  <div key={r.id} className="log-item">
                    <div>
                      <strong>{r.date}</strong> (
                      {r.dayType === "normal" ? "工作日" : "加班"})
                      <br />
                      <span style={{ fontSize: "0.9rem", color: "#aaa" }}>
                        {r.startTime} - {r.endTime}
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>
                        {formatHours(calculateWorkHours(r, settings))} H
                      </strong>
                      <br />
                      <button
                        onClick={() => handleDeleteRecord(r.id)}
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.2em 0.5em",
                          background: "#553333",
                          color: "#ffaaaa",
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
