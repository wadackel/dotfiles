# Analysis Prompt Templates

Prompt templates for common data analysis scenarios. Customize `[bracketed sections]` for each use case.

---

## 1. Conversation Log / Chat History Analysis

Use for: Claude Code sessions, chat exports, support tickets, Slack exports.

```
Analyze this conversation log excerpt and extract:

1. **Recurring Patterns**: What topics, tasks, or workflows appear repeatedly?
2. **Errors & Resolutions**: What problems were encountered and how were they resolved?
3. **User Preferences**: What style or approach preferences does the user demonstrate?
4. **Tool Usage**: Which tools or commands are used most frequently? Any misuse patterns?
5. **Missed Context**: What information was missing that caused confusion or extra questions?
6. **Workflow Candidates**: Are there multi-step procedures that appear 2+ times and could be automated?

Format each finding as:
- **Category**: Brief description
- **Evidence**: Quote or paraphrase from the data
- **Recommendation**: Actionable suggestion (if applicable)
```

---

## 2. Application / Error Log Analysis

Use for: Server logs, application logs, error reports, crash dumps.

```
Analyze this application log excerpt and identify:

1. **Error Patterns**: Recurring error types, frequencies, and time distributions
2. **Anomalies**: Unusual spikes, outliers, or unexpected sequences
3. **Root Causes**: Likely underlying causes for the most frequent errors
4. **Performance Issues**: Slow operations, timeouts, resource exhaustion signals
5. **User Impact**: Which errors are likely user-facing vs. internal?
6. **Priority Ranking**: Top 5 issues by frequency × severity

Format findings as:
- Error signature
- Occurrence count / frequency
- Probable cause
- Suggested investigation steps
```

---

## 3. General Large Text Analysis

Use for: Documentation, research papers, knowledge bases, CSV data.

```
Analyze this text excerpt and provide:

1. **Key Themes**: Main topics and how frequently they appear
2. **Notable Patterns**: Structural or content patterns worth highlighting
3. **Outliers**: Unusual entries or unexpected content
4. **Summary Statistics**: Counts, distributions, or aggregate metrics where relevant
5. **Insights**: Non-obvious observations that would be valuable to a [domain expert / developer / analyst]
6. **Open Questions**: What additional data would improve this analysis?

Be specific and cite examples from the data. Avoid generic observations.
```

---

## 4. Tool Usage & Permission Pattern Analysis

Use for: Claude Code tool logs, permission denial records, settings files.

```
Analyze this tool usage and permission data and extract:

1. **Most Used Tools**: Frequency ranking with usage context
2. **Permission Denials**: Which operations are blocked most often? Are denials intentional?
3. **Approval Patterns**: What types of operations require frequent user approval?
4. **Potential Automation**: Which denials suggest a missing `permissions.allow` rule?
5. **Security Observations**: Any unusual permission patterns or overly broad allows?
6. **Settings Recommendations**: Specific `settings.json` rule additions that would reduce friction

Format recommendations as ready-to-use JSON snippets where applicable.
```

---

## 5. Synthesis Prompt (Multi-Batch Integration)

Use after collecting results from multiple analysis batches.

```
You are synthesizing analysis results from multiple batches of the same dataset.
The batches are from different segments of the same source, so overlap and duplication are expected.

Your task:
1. **Deduplicate**: Identify and merge identical or near-identical findings
2. **Consolidate**: Merge related findings into coherent categories
3. **Rank**: Order findings by frequency of mention across batches (more mentions = higher confidence)
4. **Preserve uniqueness**: Keep findings that appear in only one batch if they seem significant
5. **Produce final report**: A single, well-structured report as if it came from one analysis pass

Maintain all concrete evidence and examples. Do not discard specific findings in favor of vague generalizations.

Output format:
## [Category Name]
- Finding: ...
- Confidence: High/Medium/Low (based on how many batches mentioned it)
- Evidence: ...
- Recommendation: ...
```

---

## Customization Tips

- **Add context**: Include the data source, time range, and purpose at the start of any prompt
- **Specify output format**: If you need JSON, ask for JSON. If you need a Markdown report, ask for that.
- **Constrain scope**: "Focus only on errors in the past 7 days" reduces noise
- **Chain prompts**: Use a targeted extraction prompt first, then a synthesis prompt on the results
