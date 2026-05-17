import { useState, useEffect } from 'react';
import axios from 'axios';

const useMetricHistory = (token, refreshToken, date, metricType, range) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!token) return;

        let cancelled = false;

        const fetchHistory = async () => {
            setError(null);
            setLoading(true);
            try {
                const response = await axios.get('http://localhost:3000/api/activity-history', {
                    params: { date, range, type: metricType, refresh: refreshToken },
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!cancelled) {
                    setData(response.data);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err);
                    setData([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchHistory();

        return () => {
            cancelled = true;
        };
    }, [token, refreshToken, date, metricType, range]);

    return { data, loading, error };
};

export default useMetricHistory;
