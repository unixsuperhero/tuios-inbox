# OSC 133 command boundaries; preserves the user's prompt and startup hooks.
autoload -Uz add-zsh-hook
_tuios_inbox_preexec() { printf '\033]133;C\007'; }
_tuios_inbox_precmd() {
  local code=$?
  if [[ -n $_tuios_inbox_started ]]; then printf '\033]133;D;%s\007' "$code"; fi
  _tuios_inbox_started=1
  printf '\033]133;A\007'
  if [[ $PROMPT != *$'\e]133;B'* ]]; then PROMPT+=$'%{\e]133;B\a%}'; fi
}
add-zsh-hook preexec _tuios_inbox_preexec
add-zsh-hook precmd _tuios_inbox_precmd
PROMPT_EOL_MARK=''
if [[ $PROMPT != *$'\e]133;B'* ]]; then PROMPT+=$'%{\e]133;B\a%}'; fi
