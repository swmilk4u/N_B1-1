const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 4001;

// 미들웨어
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('./'));

// 파일 경로
const dir = __dirname;
const file01 = path.join(dir, '01_LLM모델_비교_및_선정_보고서.md');
const file02 = path.join(dir, '02_프롬프트_시스템_설계_문서.md');
const file03 = path.join(dir, '03_실행_로그.md');

const METRICS = ['정확성', '한국어 자연스러움', '형식 준수', '문맥 유지', '응답 속도', '비용 효율'];

const DEFAULT_DATA = {
    scores: {
        gpt5: [5, 4, 5, 4, 5, 4],
        claude: [4, 5, 5, 5, 4, 5],
        gemini: [5, 3, 4, 4, 5, 4]
    },
    models: {
        gpt5: {
            name: 'GPT-5',
            company: 'OpenAI',
            year: '2026',
            strengths: '정확성, 형식 준수, 응답 속도에서 최고 점수',
            weaknesses: '한국어 자연스러움에서 평균 수준'
        },
        claude: {
            name: 'Claude Sonnet 4.6',
            company: 'Anthropic',
            year: '2025',
            strengths: '한국어 자연스러움, 문맥 유지, 비용 효율에서 우수',
            weaknesses: '정확성에서 5점 미만'
        },
        gemini: {
            name: 'Gemini 2.5 Pro',
            company: 'Google DeepMind',
            year: '2026',
            strengths: '정확성과 응답 속도에서 최고 수준',
            weaknesses: '한국어 자연스러움에서 가장 낮은 점수'
        }
    },
    selection: {
        model: 'claude',
        modelName: 'Claude Sonnet 4.6',
        reason: '전반적으로 가장 균형잡힌 성능을 보이며, 특히 한국어 처리와 문맥 이해 능력이 우수함'
    }
};

function sumScores(values) {
    return values.reduce((acc, cur) => acc + cur, 0);
}

function keyFromModelName(name = '') {
    const normalized = name.toLowerCase();
    if (normalized.includes('claude')) return 'claude';
    if (normalized.includes('gemini')) return 'gemini';
    return 'gpt5';
}

function parseScoresFromReport(content) {
    const scores = {
        gpt5: [...DEFAULT_DATA.scores.gpt5],
        claude: [...DEFAULT_DATA.scores.claude],
        gemini: [...DEFAULT_DATA.scores.gemini]
    };

    const tablePattern = /^\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*(\d)\s*\|\s*(\d)\s*\|\s*(\d)\s*\|\s*$/gm;
    const metricMap = new Map();
    let match;

    while ((match = tablePattern.exec(content)) !== null) {
        const metric = match[1].trim();
        metricMap.set(metric, [Number(match[2]), Number(match[3]), Number(match[4])]);
    }

    METRICS.forEach((metric, idx) => {
        const values = metricMap.get(metric);
        if (values) {
            scores.gpt5[idx] = values[0];
            scores.claude[idx] = values[1];
            scores.gemini[idx] = values[2];
        }
    });

    return scores;
}

function parseModelSummary(content, modelLabel) {
    const pattern = new RegExp(`- ${modelLabel} 결과 요약[\\s\\S]*?\\r?\\n\\s*- 장점:\\s*(.+)\\r?\\n\\s*- 단점:\\s*(.+)`);
    const matched = content.match(pattern);
    if (!matched) return null;
    return {
        strengths: matched[1].trim(),
        weaknesses: matched[2].trim()
    };
}

function buildDataFromMarkdown(content) {
    const scores = parseScoresFromReport(content);

    const parsedA = parseModelSummary(content, '모델 A');
    const parsedB = parseModelSummary(content, '모델 B');
    const parsedC = parseModelSummary(content, '모델 C');

    const models = {
        gpt5: { ...DEFAULT_DATA.models.gpt5, ...(parsedA || {}) },
        claude: { ...DEFAULT_DATA.models.claude, ...(parsedB || {}) },
        gemini: { ...DEFAULT_DATA.models.gemini, ...(parsedC || {}) }
    };

    const selectedNameMatch = content.match(/- 최종 선호 모델:\s*(.+)/);
    const modelName = selectedNameMatch ? selectedNameMatch[1].trim() : DEFAULT_DATA.selection.modelName;
    const model = keyFromModelName(modelName);

    const reasonMatch = content.match(/## 6\.[\s\S]*?- 최종 선정 근거[\s\S]*?\n\s*1\.\s*(.+)/);
    const reason = reasonMatch ? reasonMatch[1].trim() : DEFAULT_DATA.selection.reason;

    return {
        scores,
        models,
        selection: {
            model,
            modelName,
            reason
        },
        totals: {
            gpt5: sumScores(scores.gpt5),
            claude: sumScores(scores.claude),
            gemini: sumScores(scores.gemini)
        }
    };
}

// 현재 데이터 조회 API
app.get('/api/data', (req, res) => {
    try {
        let data = {
            ...DEFAULT_DATA,
            totals: {
                gpt5: sumScores(DEFAULT_DATA.scores.gpt5),
                claude: sumScores(DEFAULT_DATA.scores.claude),
                gemini: sumScores(DEFAULT_DATA.scores.gemini)
            }
        };

        if (fs.existsSync(file01)) {
            const content01 = fs.readFileSync(file01, 'utf8');
            data = buildDataFromMarkdown(content01);
        }

        res.json(data);
    } catch (error) {
        console.error('Error reading data:', error);
        res.status(500).json({ error: 'Failed to read data' });
    }
});

// 데이터 저장 및 마크다운 업데이트 API
app.post('/api/save', (req, res) => {
    try {
        const { scores, models, selection } = req.body;
        
        // 01 파일 업데이트
        const metrics = ['정확성', '한국어 자연스러움', '형식 준수', '문맥 유지', '응답 속도', '비용 효율'];
        let scoreTableRows = [];
        
        metrics.forEach((metric, idx) => {
            const g = scores.gpt5[idx];
            const c = scores.claude[idx];
            const gm = scores.gemini[idx];
            scoreTableRows.push(`| ${metric} | ${g} | ${c} | ${gm} |`);
        });
        
        const scoreTable = `| 평가 축 | GPT-5 (1-5) | Claude Sonnet 4.6 (1-5) | Gemini 2.5 Pro (1-5) |
|---|---|---|---|
${scoreTableRows.join('\n')}`;
        
        // 01 파일의 평가 테이블 부분 업데이트
        let content01 = fs.readFileSync(file01, 'utf8');
        const tableStart = content01.indexOf('| 평가 축 | 설명 | GPT-5');
        const tableEnd = content01.indexOf('\n\n## 5', tableStart);
        
        if (tableStart !== -1 && tableEnd !== -1) {
            const beforeTable = content01.substring(0, tableStart);
            const afterTable = content01.substring(tableEnd);
            
            const modelResults = `### 5.2 모델별 결과 요약
- 모델 A (GPT-5) 결과
  - 장점: ${models.gpt5.strengths}
  - 단점: ${models.gpt5.weaknesses}
  - 평점 합계: ${scores.gpt5.reduce((a, b) => a + b, 0)}/30점

- 모델 B (Claude Sonnet 4.6) 결과
  - 장점: ${models.claude.strengths}
  - 단점: ${models.claude.weaknesses}
  - 평점 합계: ${scores.claude.reduce((a, b) => a + b, 0)}/30점

- 모델 C (Gemini 2.5 Pro) 결과
  - 장점: ${models.gemini.strengths}
  - 단점: ${models.gemini.weaknesses}
  - 평점 합계: ${scores.gemini.reduce((a, b) => a + b, 0)}/30점`;
            
            const finalSection = `## 6. 최종 선정 결론
- 최종 선호 모델: ${selection.modelName}
- 선정 이유: ${selection.reason}

## 7. 추가 메모
- 평가 기준: ${metrics.join(', ')}
- 테스트 기간: 2026.6.4.
- 종합 점수 비교: GPT-5 (${scores.gpt5.reduce((a, b) => a + b, 0)}/30), Claude (${scores.claude.reduce((a, b) => a + b, 0)}/30), Gemini (${scores.gemini.reduce((a, b) => a + b, 0)}/30)`;
            
            content01 = beforeTable + scoreTable + '\n\n## 5. 동일 입력 및 비교 결과 요약\n' + modelResults + '\n\n' + finalSection;
        }
        
        fs.writeFileSync(file01, content01, 'utf8');
        
        res.json({ 
            success: true, 
            message: '데이터가 저장되었습니다.',
            scores: {
                gpt5Total: scores.gpt5.reduce((a, b) => a + b, 0),
                claudeTotal: scores.claude.reduce((a, b) => a + b, 0),
                geminiTotal: scores.gemini.reduce((a, b) => a + b, 0)
            }
        });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ error: 'Failed to save data', details: error.message });
    }
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`✨ 서버가 http://localhost:4001에서 실행 중입니다`);
    console.log(`📊 비교 분석 & 에디터: http://localhost:4001/모델_비교_시각화.html`);
});
