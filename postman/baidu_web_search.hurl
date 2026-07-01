POST https://qianfan.baidubce.com/v2/ai_search/web_search
X-Appbuilder-Authorization: Bearer {{BAIDU_API_KEY}}
Content-Type: application/json
```json
{
  "messages": [
    {
      "content": "北京有哪些旅游景区",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v2",
  "resource_type_filter": [{"type": "web","top_k": 5}],
  "search_recency_filter": "year"
}
```
