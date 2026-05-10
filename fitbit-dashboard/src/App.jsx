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

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tokenParam = params.get('token');
        if (tokenParam) {
            setToken(tokenParam);
            localStorage.setItem('fitbit_token', tokenParam);
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
            const response = await axios.get(`http://localhost:3000/api/health-data?date=${selectedDate}`, {
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
        window.location.href = 'http://localhost:3000/auth/fitbit';
    };

    const handleLogout = () => {
        setToken(null);
        setData(null);
        localStorage.removeItem('fitbit_token');
    };

    if (!token) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
                <div className="text-center p-12 bg-gray-900 border border-white/5 rounded-lg max-w-md w-full">
                    <div className="w-16 h-16 bg-blue-500/20 rounded-lg flex items-center justify-center mx-auto mb-6 border border-blue-500/30">
                        <Activity className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-3xl font-bold mb-3">Health Sphere</h1>
                    <p className="text-gray-400 mb-8 text-sm leading-relaxed">Track your daily health rhythm and vitals with Fitbit.</p>
                    <button
                        onClick={handleLogin}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                    >
                        Login with Fitbit
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
            {/* Header */}
            <header className="max-w-7xl mx-auto flex justify-between items-center mb-12 pb-6 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                        <Activity className="w-6 h-6 text-blue-400" />
                    </div>
                    <h1 className="text-2xl font-bold">Health Sphere</h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-gray-900 px-4 py-2 rounded-lg border border-white/5">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="bg-transparent text-sm outline-none cursor-pointer"
                        />
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    >
                        <Zap className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-4">
                        <div className="w-12 h-12 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-400">Loading health data...</p>
                    </div>
                ) : data ? (
                    <div className="space-y-12">
                        {/* Goals Section */}
                        <section>
                            <h2 className="text-lg font-bold mb-6 pb-4 border-b border-white/5">Daily goals</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <MetricCard
                                    title="Steps"
                                    current={data.activity?.summary?.steps || 0}
                                    goal={data.activity?.goals?.steps || 10000}
                                    unit="steps"
                                    icon={Footprints}
                                />
                                <MetricCard
                                    title="Distance"
                                    current={data.activity?.summary?.distances?.[0]?.distance || 0}
                                    goal={data.activity?.goals?.distance || 8}
                                    unit="km"
                                    icon={Navigation}
                                />
                                <MetricCard
                                    title="Active Zone"
                                    current={data.activity?.summary?.activeZoneMinutes?.totalMinutes || 0}
                                    goal={data.activity?.goals?.activeZoneMinutes || 30}
                                    unit="mins"
                                    icon={Award}
                                />
                                <MetricCard
                                    title="Calories"
                                    current={data.activity?.summary?.caloriesOut || 0}
                                    goal={data.activity?.goals?.caloriesOut || 2500}
                                    unit="kcal"
                                    icon={Flame}
                                />
                            </div>
                        </section>

                        {/* Activity Trends */}
                        <section>
                            <h2 className="text-lg font-bold mb-6 pb-4 border-b border-white/5">Performance trends</h2>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <ActivityChart token={token} date={date} title="Steps" metricType="steps" unit="steps" color="cyan" icon={Footprints} />
                                <ActivityChart token={token} date={date} title="Heart Rate" metricType="heart" unit="bpm" color="rose" icon={Heart} />
                                <ActivityChart token={token} date={date} title="Sleep" metricType="sleep" unit="mins" color="violet" icon={Moon} />
                                <ActivityChart token={token} date={date} title="Weight" metricType="weight" unit="kg" color="amber" icon={Scale} />
                            </div>
                        </section>

                        {/* Detailed Metrics */}
                        <section>
                            <h2 className="text-lg font-bold mb-6 pb-4 border-b border-white/5">Health metrics</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Heart Zones */}
                                <div className="bg-gray-900 border border-white/5 rounded-lg p-6">
                                    <h3 className="text-sm font-medium text-gray-400 mb-6 flex items-center gap-2">
                                        <Heart className="w-4 h-4 text-red-500" />
                                        Heart zones
                                    </h3>
                                    <div className="space-y-5">
                                        {data.heartRate?.[0]?.value?.heartRateZones?.map((zone, idx) => {
                                            const colors = ['#ef4444', '#f97316', '#eab308', '#06b6d4'];
                                            return (
                                                <div key={idx}>
                                                    <div className="flex justify-between mb-2">
                                                        <div>
                                                            <p className="text-xs font-medium text-gray-400">{zone.name}</p>
                                                            <p className="text-base font-bold text-white mt-1">{zone.minutes} <span className="text-xs text-gray-500">min</span></p>
                                                        </div>
                                                        <p className="text-xs text-gray-500">{zone.min}–{zone.max}</p>
                                                    </div>
                                                    <div className="h-1.5 bg-slate-800 rounded-sm overflow-hidden">
                                                        <div className="h-full" style={{ width: `${Math.min(100, (zone.minutes / 180) * 100)}%`, backgroundColor: colors[idx] }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Sleep */}
                                <div className="bg-gray-900 border border-white/5 rounded-lg p-6">
                                    <h3 className="text-sm font-medium text-gray-400 mb-6 flex items-center gap-2">
                                        <Moon className="w-4 h-4 text-purple-500" />
                                        Sleep architecture
                                    </h3>
                                    {data.sleepSummary?.stages ? (
                                        <div className="space-y-4">
                                            <div className="p-3 border border-white/5 rounded-lg">
                                                <p className="text-xs text-gray-400">Total</p>
                                                <p className="text-lg font-bold mt-1">{(data.sleepSummary.totalMinutesAsleep / 60).toFixed(1)} <span className="text-xs text-gray-500">hrs</span></p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <StageBox label="Deep" value={data.sleepSummary.stages.deep} color="#7c3aed" />
                                                <StageBox label="REM" value={data.sleepSummary.stages.rem} color="#a855f7" />
                                                <StageBox label="Light" value={data.sleepSummary.stages.light} color="#d8b4fe" />
                                                <StageBox label="Awake" value={data.sleepSummary.stages.wake} color="#6b7280" />
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">No data available</p>
                                    )}
                                </div>

                                {/* Nutrition */}
                                <div className="bg-gray-900 border border-white/5 rounded-lg p-6">
                                    <h3 className="text-sm font-medium text-gray-400 mb-6 flex items-center gap-2">
                                        <Utensils className="w-4 h-4 text-emerald-500" />
                                        Nutrition
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="p-3 border border-white/5 rounded-lg">
                                            <p className="text-xs text-gray-400">Water</p>
                                            <p className="text-lg font-bold mt-1">{data.nutrition?.water?.summary?.water || 0} <span className="text-xs text-gray-500">ml</span></p>
                                        </div>
                                        <div className="space-y-3 pt-3 border-t border-white/5">
                                            <MacroLine label="Protein" val={data.nutrition?.food?.summary?.protein || 0} max={150} color="#10b981" />
                                            <MacroLine label="Carbs" val={data.nutrition?.food?.summary?.carbs || 0} max={300} color="#0ea5e9" />
                                            <MacroLine label="Fats" val={data.nutrition?.food?.summary?.fat || 0} max={80} color="#f59e0b" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Devices */}
                        <section>
                            <h2 className="text-lg font-bold mb-6 pb-4 border-b border-white/5">Connected devices</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {data.devices?.map((device, idx) => (
                                    <div key={idx} className="bg-gray-900 border border-white/5 rounded-lg p-4">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="p-2 bg-blue-500/10 rounded">
                                                <Watch className="w-4 h-4 text-blue-400" />
                                            </div>
                                            <span className={`text-xs font-medium px-2 py-1 rounded ${device.battery === 'Low' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                                {device.battery}
                                            </span>
                                        </div>
                                        <h4 className="text-sm font-bold">{device.deviceVersion}</h4>
                                        <p className="text-xs text-gray-500 mt-2">Synced: {new Date(device.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="text-center py-32">
                        <Info className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                        <h2 className="text-xl font-bold mb-2">No data available</h2>
                        <p className="text-gray-400 mb-6">Try reconnecting or selecting a different date</p>
                        <button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-lg">
                            Reconnect
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}

function MetricCard({ title, current, goal, unit, icon: Icon }) {
    const progress = Math.min(100, (current / goal) * 100);
    const isAboveGoal = current >= goal;
    const barColor = isAboveGoal ? '#10b981' : '#0ea5e9';

    return (
        <div className="bg-gray-900 border border-white/5 rounded-lg p-4 hover:border-white/10 transition-colors">
            <div className="flex items-start justify-between mb-3">
                <div className="p-2 bg-blue-500/10 rounded">
                    <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-xs font-medium text-gray-400">{title}</p>
            </div>
            <h4 className="text-lg font-bold text-white mb-3">
                {current.toLocaleString()}
                {unit && <span className="text-xs text-gray-500 ml-1">{unit}</span>}
            </h4>
            <div className="h-1.5 bg-slate-800 rounded-sm overflow-hidden mb-2">
                <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: barColor }} />
            </div>
            <p className="text-xs text-gray-500">vs {goal.toLocaleString()}</p>
        </div>
    );
}

function StageBox({ label, value, color }) {
    return (
        <div className="p-3 border border-white/5 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-400">{label}</span>
            </div>
            <p className="text-base font-bold">{value} <span className="text-xs text-gray-500">min</span></p>
        </div>
    );
}

function MacroLine({ label, val, max, color }) {
    const percent = Math.min(100, (val / max) * 100);
    return (
        <div>
            <div className="flex justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-400">{label}</span>
                <span className="text-xs font-bold">{val}g <span className="text-gray-500 font-normal">/ {max}g</span></span>
            </div>
            <div className="h-1 bg-slate-800 rounded-sm overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${percent}%`, backgroundColor: color }} />
            </div>
        </div>
    );
}

export default App;
