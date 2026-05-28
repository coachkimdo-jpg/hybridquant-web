import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api/v1';

export const getScreenData = async () => {
    const response = await axios.get(`${API_BASE_URL}/screen`);
    return response.data;
};

export const getChartData = async (ticker: string) => {
    const response = await axios.get(`${API_BASE_URL}/chart/${ticker}`);
    return response.data;
};
