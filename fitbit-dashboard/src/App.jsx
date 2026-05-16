import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, Heart, Flame, Footprints, Moon, Droplets,
    Utensils, Scale, Watch, Smartphone, Navigation,
    Calendar, Zap, Award, Target, Info, ChevronRight, TrendingUp
} from 'lucide-react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import ActivityChart from './components/ActivityChart';

function App() {
    const [token, setToken] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('theme-mode');
        return saved ? saved === 'dark' : true;
    });
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [sliderTooltip, setSliderTooltip] = useState({ visible: false, label: '' });

    const SLIDER_DAYS = 30;

    const dateToIndex = (dateStr) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = Math.round((today - new Date(dateStr)) / 86400000);
        return Math.max(0, Math.min(SLIDER_DAYS - 1, SLIDER_DAYS - 1 - diff));
    };

    const indexToDate = (idx) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (SLIDER_DAYS - 1 - idx));
        return d.toISOString().split('T')[0];
    };

    const formatDate = (dateStr) =>
        new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tokenParam = params.get('token');
        const refreshParam = params.get('refresh');
        if (tokenParam) {
            setToken(tokenParam);
            localStorage.setItem('fitbit_token', tokenParam);
            if (refreshParam) {
                localStorage.setItem('fitbit_refresh_token', refreshParam);
            }
            window.history.replaceState({}, document.title, "/dashboard");
        } else {
            const storedToken = localStorage.getItem('fitbit_token');
            if (storedToken) setToken(storedToken);
        }
    }, []);

    useEffect(() => {
        if (token) fetchHealthData(date);
    }, [token, date]);

    const fetchHealthData = async (selectedDate) => {
        setLoading(true);
        try {
            const refreshToken = localStorage.getItem('fitbit_refresh_token');
            const url = `http://localhost:3000/api/health-data?date=${selectedDate}${refreshToken ? `&refresh=${refreshToken}` : ''}`;
            const response = await axios.get(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setData(response.data);
        } catch (error) {
            console.error("Error fetching data", error);
            if (error.response?.status === 401) handleLogout();
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = () => {
        window.location.href = 'http://localhost:3000/auth/google';
    };

    const handleLogout = () => {
        setShowLogoutConfirm(false);
        setToken(null);
        setData(null);
        localStorage.removeItem('fitbit_token');
        localStorage.removeItem('fitbit_refresh_token');
    };

    const confirmLogout = () => {
        setShowLogoutConfirm(true);
    };

    const toggleTheme = () => {
        const newMode = !isDarkMode;
        setIsDarkMode(newMode);
        localStorage.setItem('theme-mode', newMode ? 'dark' : 'light');
    };

    if (!token) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
                <div className={`text-center p-12 rounded-lg max-w-md w-full border ${isDarkMode ? 'bg-gray-900 border-white/5' : 'bg-white border-slate-200'}`}>
                    <div className={`w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-6 border ${isDarkMode ? 'bg-blue-500/20 border-blue-500/30' : 'bg-blue-100 border-blue-300'}`}>
                        <Activity className={`w-8 h-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    </div>
                    <h1 className="text-3xl font-bold mb-3">Health Sphere</h1>
                    <p className={`mb-8 text-sm leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Track your daily health rhythm and vitals with Fitbit.</p>
                    <button
                        onClick={handleLogin}
                        className={`w-full font-bold py-3 px-6 rounded-lg transition-colors ${isDarkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
                    >
                        Login with Fitbit
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen p-8 font-sans ${isDarkMode ? 'bg-slate-950 text-slate-50' : 'bg-slate-50 text-slate-900'}`}>
            {/* Header */}
            <header className={`max-w-7xl mx-auto flex items-center mb-12 pb-6 border-b ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>
                <div className="flex items-center gap-3 shrink-0">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-blue-500/10' : 'bg-blue-100'}`}>
                        <Activity className={`w-6 h-6 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    </div>
                    <h1 className="text-2xl font-bold">Health Sphere</h1>
                </div>

                {/* Centre zone: date input + slider */}
                <div className="flex items-center gap-3 flex-1 mx-4 min-w-0">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={`text-sm outline-none cursor-pointer rounded px-2 py-1 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-slate-100 text-slate-900'}`}
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                    />
                    <div className="relative flex-1 min-w-0">
                        {sliderTooltip.visible && (
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap z-10">
                                {sliderTooltip.label}
                            </div>
                        )}
                        <input
                            type="range"
                            min={0}
                            max={SLIDER_DAYS - 1}
                            value={dateToIndex(date)}
                            onChange={(e) => setDate(indexToDate(Number(e.target.value)))}
                            onMouseMove={(e) => {
                                const rect = e.target.getBoundingClientRect();
                                const ratio = (e.clientX - rect.left) / rect.width;
                                const idx = Math.round(ratio * (SLIDER_DAYS - 1));
                                setSliderTooltip({ visible: true, label: formatDate(indexToDate(Math.max(0, Math.min(SLIDER_DAYS - 1, idx)))) });
                            }}
                            onMouseLeave={() => setSliderTooltip({ visible: false, label: '' })}
                            className="w-full accent-blue-500 cursor-pointer"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                    <button
                        onClick={toggleTheme}
                        className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-yellow-400' : 'text-slate-600 hover:text-slate-900'}`}
                        title={isDarkMode ? 'Light mode' : 'Dark mode'}
                    >
                        {isDarkMode ? '☀️' : '🌙'}
                    </button>
                    <button
                        onClick={confirmLogout}
                        className={`p-2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-red-400' : 'text-slate-600 hover:text-red-600'}`}
                        title="Logout"
                    >
                        <Zap className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-4">
                        <div className={`w-12 h-12 border-2 rounded-full animate-spin ${isDarkMode ? 'border-blue-500/20 border-t-blue-500' : 'border-blue-300 border-t-blue-600'}`} />
                        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Loading health data...</p>
                    </div>
                ) : data ? (
                    <div className="space-y-12">
                        {/* Goals Section */}
                        <section>
                            <h2 className={`text-lg font-bold mb-6 pb-4 border-b ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>Daily goals</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <MetricCard
                                    title="Steps"
                                    current={data.activity?.summary?.steps || 0}
                                    goal={data.activity?.goals?.steps || 10000}
                                    unit="steps"
                                    icon={Footprints}
                                    isDarkMode={isDarkMode}
                                />
                                <MetricCard
                                    title="Distance"
                                    current={data.activity?.summary?.distances?.[0]?.distance || 0}
                                    goal={data.activity?.goals?.distance || 8}
                                    unit="km"
                                    icon={Navigation}
                                    isDarkMode={isDarkMode}
                                />
                                <MetricCard
                                    title="Active Zone"
                                    current={data.activity?.summary?.activeZoneMinutes?.totalMinutes || 0}
                                    goal={data.activity?.goals?.activeZoneMinutes || 30}
                                    unit="mins"
                                    icon={Award}
                                    isDarkMode={isDarkMode}
                                />
                                <MetricCard
                                    title="Calories"
                                    current={data.activity?.summary?.caloriesOut || 0}
                                    goal={data.activity?.goals?.caloriesOut || 2500}
                                    unit="kcal"
                                    icon={Flame}
                                    isDarkMode={isDarkMode}
                                />
                            </div>
                        </section>

                        {/* Activity Trends */}
                        <section>
                            <h2 className={`text-lg font-bold mb-6 pb-4 border-b ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>Performance trends</h2>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <ActivityChart token={token} date={date} title="Steps" metricType="steps" unit="steps" color="cyan" icon={Footprints} isDarkMode={isDarkMode} onDateSelect={setDate} />
                                <ActivityChart token={token} date={date} title="Heart Rate" metricType="heart" unit="bpm" color="rose" icon={Heart} isDarkMode={isDarkMode} onDateSelect={setDate} />
                                <ActivityChart token={token} date={date} title="Sleep" metricType="sleep" unit="mins" color="violet" icon={Moon} isDarkMode={isDarkMode} onDateSelect={setDate} />
                                <ActivityChart token={token} date={date} title="Weight" metricType="weight" unit="kg" color="amber" icon={Scale} isDarkMode={isDarkMode} onDateSelect={setDate} />
                            </div>
                        </section>

                        {/* Detailed Metrics */}
                        <section>
                            <h2 className={`text-lg font-bold mb-6 pb-4 border-b ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>Health metrics</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Heart Zones */}
                                <div className={`border rounded-lg p-6 ${isDarkMode ? 'bg-gray-900 border-white/5' : 'bg-white border-slate-200'}`}>
                                    <h3 className={`text-sm font-medium mb-4 flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                        <Heart className="w-4 h-4 text-red-500" />
                                        Heart zones
                                    </h3>
                                    {/* Min / Avg / Max BPM row */}
                                    <div className="grid grid-cols-3 gap-2 mb-6">
                                        {[
                                            { label: 'Min', value: data.heartRate?.[0]?.value?.minBpm },
                                            { label: 'Avg', value: data.heartRate?.[0]?.value?.avgBpm },
                                            { label: 'Max', value: data.heartRate?.[0]?.value?.maxBpm },
                                        ].map(({ label, value }) => (
                                            <div key={label} className={`rounded p-2 text-center ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                                                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>{label}</p>
                                                <p className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                                    {value || '—'}
                                                    {value ? <span className={`text-xs font-normal ml-0.5 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>bpm</span> : null}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="space-y-5">
                                        {data.heartRate?.[0]?.value?.heartRateZones?.map((zone, idx) => {
                                            const colors = ['#ef4444', '#f97316', '#eab308', '#06b6d4'];
                                            return (
                                                <div key={idx}>
                                                    <div className="flex justify-between mb-2">
                                                        <div>
                                                            <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{zone.name}</p>
                                                            <p className={`text-base font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{zone.minutes} <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>min</span></p>
                                                        </div>
                                                        <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>{zone.min}–{zone.max}</p>
                                                    </div>
                                                    <div className={`h-1.5 rounded-sm overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
                                                        <div className="h-full" style={{ width: `${Math.min(100, (zone.minutes / 180) * 100)}%`, backgroundColor: colors[idx] }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Sleep */}
                                <div className={`border rounded-lg p-6 ${isDarkMode ? 'bg-gray-900 border-white/5' : 'bg-white border-slate-200'}`}>
                                    <h3 className={`text-sm font-medium mb-6 flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                        <Moon className="w-4 h-4 text-purple-500" />
                                        Sleep architecture
                                    </h3>
                                    {data.sleepSummary?.totalMinutesAsleep > 0 ? (
                                        <div className="space-y-4">
                                            <div className={`p-3 border rounded-lg ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>
                                                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Total</p>
                                                <p className={`text-lg font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{(data.sleepSummary.totalMinutesAsleep / 60).toFixed(1)} <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>hrs</span></p>
                                            </div>
                                            {(data.sleepSummary.stages.deep + data.sleepSummary.stages.rem + data.sleepSummary.stages.light) > 0 ? (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <StageBox label="Deep" value={data.sleepSummary.stages.deep} color="#7c3aed" isDarkMode={isDarkMode} />
                                                    <StageBox label="REM" value={data.sleepSummary.stages.rem} color="#a855f7" isDarkMode={isDarkMode} />
                                                    <StageBox label="Light" value={data.sleepSummary.stages.light} color="#d8b4fe" isDarkMode={isDarkMode} />
                                                    <StageBox label="Awake" value={data.sleepSummary.stages.wake} color="#6b7280" isDarkMode={isDarkMode} />
                                                </div>
                                            ) : (
                                                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Stage breakdown not available for this device</p>
                                            )}
                                            {data.sleepSummary?.bedtime != null && (
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    {[
                                                        { label: 'Bedtime', text: new Date(data.sleepSummary.bedtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                                                        { label: 'Wake time', text: new Date(data.sleepSummary.wakeTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                                                        { label: 'In bed', text: `${(data.sleepSummary.inBedMinutes / 60).toFixed(1)} hrs` },
                                                        { label: 'Efficiency', text: `${data.sleepSummary.efficiency}%` },
                                                    ].map(({ label, text }) => (
                                                        <div key={label} className={`border rounded-lg p-3 ${isDarkMode ? 'bg-gray-800 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                                                            <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{label}</p>
                                                            <p className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{text}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>No sleep data recorded</p>
                                    )}
                                </div>

                                {/* Nutrition */}
                                <div className={`border rounded-lg p-6 ${isDarkMode ? 'bg-gray-900 border-white/5' : 'bg-white border-slate-200'}`}>
                                    <h3 className={`text-sm font-medium mb-6 flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                        <Utensils className="w-4 h-4 text-emerald-500" />
                                        Nutrition
                                    </h3>
                                    <div className="space-y-4">
                                        <div className={`p-3 border rounded-lg ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>
                                            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Water</p>
                                            <p className={`text-lg font-bold mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.nutrition?.water?.summary?.water || 0} <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>ml</span></p>
                                        </div>
                                        <div className={`space-y-3 pt-3 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>
                                            <MacroLine label="Protein" val={data.nutrition?.food?.summary?.protein || 0} max={150} color="#10b981" isDarkMode={isDarkMode} />
                                            <MacroLine label="Carbs" val={data.nutrition?.food?.summary?.carbs || 0} max={300} color="#0ea5e9" isDarkMode={isDarkMode} />
                                            <MacroLine label="Fats" val={data.nutrition?.food?.summary?.fat || 0} max={80} color="#f59e0b" isDarkMode={isDarkMode} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="text-center py-32">
                        <Info className={`w-12 h-12 mx-auto mb-4 ${isDarkMode ? 'text-gray-700' : 'text-slate-400'}`} />
                        <h2 className="text-xl font-bold mb-2">No data available</h2>
                        <p className={`mb-6 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Try reconnecting or selecting a different date</p>
                        <button onClick={handleLogin} className={`font-bold px-6 py-2 rounded-lg transition-colors ${isDarkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}>
                            Reconnect
                        </button>
                    </div>
                )}
            </main>

            {/* Logout Confirmation Modal */}
            {showLogoutConfirm && (
                <div className={`fixed inset-0 flex items-center justify-center p-4 ${isDarkMode ? 'bg-black/50' : 'bg-black/30'}`}>
                    <div className={`rounded-lg p-6 max-w-sm w-full border ${isDarkMode ? 'bg-gray-900 border-white/10' : 'bg-white border-slate-200'}`}>
                        <h3 className={`text-lg font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Logout Confirmation</h3>
                        <p className={`mb-6 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Are you sure you want to logout? You'll need to reauthenticate to access your health data again.</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowLogoutConfirm(false)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-900'}`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleLogout}
                                className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function MetricCard({ title, current, goal, unit, icon: Icon, isDarkMode }) {
    const progress = Math.min(100, (current / goal) * 100);
    const isAboveGoal = current >= goal;
    const barColor = isAboveGoal ? '#10b981' : '#0ea5e9';

    return (
        <div className={`border rounded-lg p-4 transition-colors ${isDarkMode ? 'bg-gray-900 border-white/5 hover:border-white/10' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
            <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded ${isDarkMode ? 'bg-blue-500/10' : 'bg-blue-100'}`}>
                    <Icon className={`w-4 h-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                </div>
                <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{title}</p>
            </div>
            <h4 className={`text-lg font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {current.toLocaleString()}
                {unit && <span className={`text-xs ml-1 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>{unit}</span>}
            </h4>
            <div className={`h-1.5 rounded-sm overflow-hidden mb-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: barColor }} />
            </div>
            <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>vs {goal.toLocaleString()}</p>
        </div>
    );
}

function StageBox({ label, value, color, isDarkMode }) {
    return (
        <div className={`p-3 border rounded-lg ${isDarkMode ? 'border-white/5' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{label}</span>
            </div>
            <p className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{value} <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>min</span></p>
        </div>
    );
}

function MacroLine({ label, val, max, color, isDarkMode }) {
    const percent = Math.min(100, (val / max) * 100);
    return (
        <div>
            <div className="flex justify-between mb-1.5">
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{label}</span>
                <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{val}g <span className={`font-normal ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>/ {max}g</span></span>
            </div>
            <div className={`h-1 rounded-sm overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
                <div className="h-full transition-all" style={{ width: `${percent}%`, backgroundColor: color }} />
            </div>
        </div>
    );
}

export default App;
