// prints the sherpa-onnx library's version, git commit and date, so Wisp's
// speech server can be built against the matching c-api.h
#include <stdio.h>

const char *SherpaOnnxGetVersionStr(void);
const char *SherpaOnnxGetGitSha1(void);
const char *SherpaOnnxGetGitDate(void);

int main(void) {
  printf("%s %s %s\n", SherpaOnnxGetVersionStr(), SherpaOnnxGetGitSha1(), SherpaOnnxGetGitDate());
  return 0;
}
