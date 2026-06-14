import { tool } from "@langchain/core/tools";
import * as z from "zod";

export const getWeather = tool(
  async (input) => {
    const resp = await fetch(
      `https://uapis.cn/api/v1/misc/weather?city=${encodeURIComponent(input.city)}`,
    );
    const data = (await resp.json()) as {
      province: string;
      city: string;
      weather: string;
      temperature: number;
      wind_direction: string;
      wind_power: string;
      humidity: number;
      report_time: string;
    };
    return `${input.city} 当前天气: ${data.weather}, 气温: ${data.temperature}摄氏度, ${data.wind_direction}${data.wind_power}, 相对湿度: ${data.humidity}, 报告时间: ${data.report_time}`;
  },
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string().describe("The city to get the weather for"),
    }),
  },
);
