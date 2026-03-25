# PE Diagnostic Export

## 1. Root cause summary
- 目标 case 总数：19
- insufficient_data：11
- unknown：8
- multiple_missing：0
- peer_pe_missing：0
- unknown_path：8

## 2. Files changed
- scripts/pe-regression.js

## 3. insufficient_data 明细表
| stockCode | pe.status | offerPriceMid | totalShares | marketCapMid | industry | natureCode | peerMedianPE | peerPEStatus.status | peerPEStatus.reason | netProfitHKD | missingFields | firstBlockingStep | recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01021 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 01989 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02632 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02649 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | 39600 | offerPriceMid, totalShares, marketCapMid, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02692 | insufficient_data | null | 267482700 | null | null | null | null | network_error | Request failed with status code 403 | 1069700000 | offerPriceMid, marketCapMid, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02706 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02714 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | 4963800000 | offerPriceMid, totalShares, marketCapMid, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 02726 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | 118250 | offerPriceMid, totalShares, marketCapMid, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 03268 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 03355 | insufficient_data | null | 400000000 | null | null | null | null | network_error | Request failed with status code 403 | 414856200 | offerPriceMid, marketCapMid, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |
| 06636 | insufficient_data | null | null | null | null | null | null | network_error | Request failed with status code 403 | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | ipo_detail_missing | 优先补齐 IPO 详情抓取证据链，单独记录 etnet 详情抓取失败原因与静态缓存命中情况 |

## 4. unknown 明细表
| stockCode | pe.status | offerPriceMid | totalShares | marketCapMid | industry | natureCode | peerMedianPE | peerPEStatus.status | peerPEStatus.reason | netProfitHKD | missingFields | firstBlockingStep | recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01347 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 02358 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 09527 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 03456 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 01789 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 09998 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 02345 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |
| 06789 | unknown | null | null | null | null | null | null | unknown | null | null | offerPriceMid, totalShares, marketCapMid, netProfitHKD, industry, natureCode, peerMedianPE | unknown_path | 补充 unknown 路径诊断日志，输出从 IPO 字段到 peer PE 的逐步阻塞点 |

## 5. firstBlockingStep 分布
| firstBlockingStep | count |
| --- | --- |
| ipo_detail_missing | 11 |
| unknown_path | 8 |

## 6. missingFields 组合分布
| missingFields combination | count |
| --- | --- |
| offerPriceMid + totalShares + marketCapMid + netProfitHKD + industry + natureCode + peerMedianPE | 14 |
| offerPriceMid + totalShares + marketCapMid + industry + natureCode + peerMedianPE | 3 |
| offerPriceMid + marketCapMid + industry + natureCode + peerMedianPE | 2 |

## 7. 你判断的下一步最优修复点
- 优先在 PE 诊断链路增加字段级 firstBlockingStep 输出，把当前被折叠为 multiple_missing 的 case 继续拆成 IPO 详情缺失、净利润缺失、industry/natureCode 缺失、peer PE 缺失等子路径。
- 第二优先级是把 peerPEStatus 的失败原因与 IPO 详情字段缺失拆成可汇总的结构化枚举，避免 insufficient_data / unknown 继续混叠。
